import {
    _decorator, assetManager, Camera, Canvas, Color, Component, director, EffectAsset, EventKeyboard,
    EventTouch, Input, input, KeyCode, Label, Layers, Material, MeshRenderer, Node, primitives,
    Scene, UITransform, utils, Vec3, view,
} from 'cc';

const { ccclass } = _decorator;

/** Distance between the centers of the three lanes. */
const LANE_X = [-3.2, 0, 3.2];
const MIN_SPEED = 8;
const MAX_SPEED = 34;
const START_SPEED = 18;

/**
 * Internal uuid of the `builtin-standard` effect. The effect is not part of the
 * engine's preloaded assets, so `new Material().initialize({ effectName })` alone
 * silently produces a material with zero passes (and assigning it to a
 * MeshRenderer throws inside SubModel). Loading the asset registers it by name.
 */
const PBR_EFFECT_UUID = 'c8f66d17-351a-48da-a12c-0212d28575c4';
const PBR_EFFECT_NAME = 'builtin-standard';
const UNLIT_EFFECT_NAME = 'builtin-unlit';

function ensurePbrEffect(): Promise<void> {
    if (EffectAsset.get(PBR_EFFECT_NAME)) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        // Never keep the game waiting on an internal asset: fall back to the
        // preloaded unlit effect when loading fails or takes too long.
        setTimeout(finish, 3000);
        try {
            assetManager.loadAny(PBR_EFFECT_UUID, (error) => {
                if (error) {
                    console.warn('[CarKing] builtin-standard effect unavailable, falling back to unlit materials', error);
                }
                finish();
            });
        } catch (error) {
            console.warn('[CarKing] builtin-standard effect unavailable, falling back to unlit materials', error);
            finish();
        }
    });
}

interface TrafficCar {
    node: Node;
    lane: number;
    z: number;
    speed: number;
    passed: boolean;
}

/**
 * Builds and runs the whole three-lane overtaking demo with code only.
 *
 * The component does not rely on any hand-wired scene object: it creates its own
 * world root, camera and UI under the running scene. That keeps it safe to attach
 * to any node (a camera, an empty node, or the scene itself).
 */
@ccclass('CarKingGame')
export class CarKingGame extends Component {
    private world: Node | null = null;
    private canvas: Node | null = null;
    private uiCamera: Camera | null = null;
    private camera: Camera | null = null;
    private player: Node | null = null;
    private hudNode: Node | null = null;
    private overlayNode: Node | null = null;
    private hud: Label | null = null;
    private overlay: Label | null = null;
    private traffic: TrafficCar[] = [];
    private roadMarks: Node[] = [];
    private readonly materials: Record<string, Material> = {};

    private lane = 1;
    private speed = START_SPEED;
    private distance = 0;
    private overtakes = 0;
    private gameOver = false;
    private inputBound = false;
    private uiLayoutBound = false;

    public onLoad(): void {
        void this.bootstrap();
    }

    private async bootstrap(): Promise<void> {
        await ensurePbrEffect();
        if (!this.isValid) {
            return;
        }
        this.buildGame();
    }

    public onDestroy(): void {
        this.unbindInput();
        this.unscheduleAllCallbacks();
        view.off('canvas-resize', this.layoutUI, this);
        view.off('design-resolution-changed', this.layoutUI, this);
        this.uiLayoutBound = false;
        for (const material of Object.values(this.materials)) {
            material.destroy();
        }
    }

    // #region setup

    private buildGame(): void {
        const scene = director.getScene();
        if (!scene) {
            console.error('[CarKing] no scene is running, the game cannot start');
            return;
        }

        this.resetState();
        this.createMaterials();
        this.createCamera(scene);

        const world = new Node('CarKing World');
        world.layer = Layers.Enum.DEFAULT;
        world.setParent(scene);
        this.world = world;

        this.createRoad(world);
        this.player = this.makeCar(world, 'Player car', 'blue');
        this.player.setPosition(LANE_X[this.lane], 0, 0);
        this.createTraffic(world);
        this.createUI(scene);
        this.bindInput();

        this.updateCamera();
        this.updateHud();
        this.showIntro();

        console.info('[CarKing] game started', {
            scene: scene.name || '(unnamed scene)',
            traffic: this.traffic.length,
            lanes: LANE_X.length,
        });
    }

    private resetState(): void {
        this.lane = 1;
        this.speed = START_SPEED;
        this.distance = 0;
        this.overtakes = 0;
        this.gameOver = false;
        this.traffic = [];
        this.roadMarks = [];
        this.player = null;
        this.hudNode = null;
        this.overlayNode = null;
        this.uiCamera = null;
        this.hud = null;
        this.overlay = null;
    }

    private restart(): void {
        this.unscheduleAllCallbacks();
        this.world?.destroy();
        this.world = null;
        this.canvas?.destroy();
        this.canvas = null;
        this.buildGame();
    }

    /**
     * Reuses the scene camera that renders the default (3D) layer, or creates one
     * when the scene has no usable camera. The game world never becomes a child of
     * the camera, so moving/looking around cannot drag the road along with it.
     */
    private createCamera(scene: Scene): void {
        let camera: Camera | null = null;
        for (const candidate of scene.getComponentsInChildren(Camera)) {
            if ((candidate.visibility & Layers.Enum.DEFAULT) !== 0) {
                camera = candidate;
                break;
            }
        }
        if (!camera) {
            const cameraNode = new Node('CarKing Camera');
            cameraNode.layer = Layers.Enum.DEFAULT;
            cameraNode.setParent(scene);
            cameraNode.setPosition(0, 7.2, -12.5);
            camera = cameraNode.addComponent(Camera);
        }

        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.fov = 55;
        camera.near = 0.1;
        camera.far = 400;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(126, 187, 232, 255);
        // Only the 3D layer: the UI has its own orthographic camera, otherwise the
        // labels would be projected with the perspective matrix and fly off screen.
        camera.visibility = Layers.Enum.DEFAULT;
        camera.priority = 0;
        this.camera = camera;
    }

    private createMaterials(): void {
        if (Object.keys(this.materials).length > 0) {
            return;
        }
        const definitions: [string, Color][] = [
            ['road', new Color(43, 48, 57)],
            ['grass', new Color(42, 106, 68)],
            ['line', new Color(238, 227, 178)],
            ['white', new Color(236, 239, 241)],
            ['glass', new Color(54, 111, 144)],
            ['tire', new Color(25, 28, 32)],
            ['red', new Color(209, 54, 49)],
            ['blue', new Color(47, 119, 212)],
            ['yellow', new Color(243, 181, 48)],
            ['cyan', new Color(55, 190, 190)],
            ['orange', new Color(235, 112, 44)],
            ['lamp', new Color(255, 220, 140)],
        ];
        for (const [name, color] of definitions) {
            this.materials[name] = this.createMaterial(color);
        }
    }

    /**
     * Creates a colored material. PBR is used when the standard effect is loaded
     * (nicer lighting); otherwise the always-preloaded unlit effect keeps the demo
     * rendering instead of crashing on a pass-less material.
     */
    private createMaterial(color: Color): Material {
        if (EffectAsset.get(PBR_EFFECT_NAME)) {
            const pbr = new Material();
            pbr.initialize({ effectName: PBR_EFFECT_NAME });
            if (pbr.passes.length > 0) {
                pbr.setProperty('albedo', color);
                return pbr;
            }
            pbr.destroy();
        }
        const unlit = new Material();
        unlit.initialize({ effectName: UNLIT_EFFECT_NAME });
        unlit.setProperty('mainColor', color);
        return unlit;
    }

    private box(parent: Node, name: string, size: Vec3, position: Vec3, material: string): Node {
        if (!(parent instanceof Node)) {
            throw new TypeError(`[CarKing] Cannot create ${name}: parent is not a Node`);
        }
        const materialAsset = this.materials[material];
        if (!materialAsset) {
            throw new Error(`[CarKing] Material "${material}" was not initialized before creating ${name}`);
        }
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        node.setParent(parent);
        node.setPosition(position);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = utils.createMesh(primitives.box({
            width: size.x,
            height: size.y,
            length: size.z,
        }));
        renderer.setMaterial(materialAsset, 0);
        return node;
    }

    private createRoad(world: Node): void {
        this.box(world, 'Road', new Vec3(11, 0.15, 240), new Vec3(0, -0.12, 40), 'road');
        this.box(world, 'Left verge', new Vec3(36, 0.2, 240), new Vec3(-23, -0.25, 40), 'grass');
        this.box(world, 'Right verge', new Vec3(36, 0.2, 240), new Vec3(23, -0.25, 40), 'grass');

        for (const x of [-1.65, 1.65]) {
            for (let z = -100; z < 180; z += 10) {
                this.roadMarks.push(this.box(world, 'Lane dash', new Vec3(0.12, 0.025, 4.6), new Vec3(x, -0.025, z), 'line'));
            }
        }
        for (const x of [-5.35, 5.35]) {
            this.box(world, 'Edge line', new Vec3(0.1, 0.03, 240), new Vec3(x, -0.025, 40), 'white');
        }
        for (let z = -80; z < 200; z += 24) {
            for (const x of [-9, 9]) {
                this.box(world, 'Roadside post', new Vec3(0.22, 1.3, 0.22), new Vec3(x, 0.55, z), 'white');
                this.box(world, 'Roadside sign', new Vec3(0.55, 0.35, 0.12), new Vec3(x, 1.15, z), 'yellow');
            }
        }
    }

    private makeCar(parent: Node, name: string, color: string): Node {
        const car = new Node(name);
        car.layer = Layers.Enum.DEFAULT;
        car.setParent(parent);
        this.box(car, 'Body', new Vec3(1.7, 0.62, 3.15), new Vec3(0, 0.58, 0), color);
        this.box(car, 'Hood', new Vec3(1.52, 0.18, 0.9), new Vec3(0, 0.91, 1.02), color);
        this.box(car, 'Cabin', new Vec3(1.23, 0.68, 1.45), new Vec3(0, 1.15, -0.18), 'glass');
        this.box(car, 'Roof', new Vec3(1.12, 0.12, 1.05), new Vec3(0, 1.54, -0.12), color);
        for (const side of [-1, 1]) {
            for (const z of [-0.95, 1.0]) {
                this.box(car, 'Wheel', new Vec3(0.25, 0.58, 0.72), new Vec3(side * 0.91, 0.37, z), 'tire');
            }
        }
        for (const side of [-1, 1]) {
            this.box(car, 'Headlight', new Vec3(0.34, 0.17, 0.08), new Vec3(side * 0.53, 0.66, 1.61), 'lamp');
            this.box(car, 'Tail light', new Vec3(0.34, 0.18, 0.08), new Vec3(side * 0.53, 0.68, -1.61), 'red');
        }
        return car;
    }

    private createTraffic(world: Node): void {
        const colors = ['red', 'yellow', 'cyan', 'orange'];
        for (let i = 0; i < 7; i++) {
            let lane = (i * 2 + 1) % 3;
            // Keep the nearest cars out of the player's lane, otherwise the player
            // crashes within two seconds without being able to react.
            if (lane === this.lane && i < 3) {
                lane = (lane + 1) % 3;
            }
            const z = 60 + i * 26 + Math.random() * 9;
            const car = this.makeCar(world, 'Traffic car', colors[i % colors.length]);
            car.setScale(0.94, 0.94, 0.94);
            car.setPosition(LANE_X[lane], 0, z);
            this.traffic.push({ node: car, lane, z, speed: 8 + Math.random() * 5, passed: false });
        }
    }

    /**
     * Runtime UI: a Canvas at the origin plus its own orthographic UI camera.
     *
     * A perspective camera cannot render UI_2D, and letting Canvas own the camera
     * couples the UI origin to the canvas node position (which does not follow
     * window resizes). Keeping both at the origin means UI coordinates are always
     * screen-centred; only the orthographic height has to be refreshed on resize.
     */
    private createUI(scene: Scene): void {
        const size = view.getVisibleSize();

        const canvasNode = new Node('CarKing Canvas');
        canvasNode.layer = Layers.Enum.UI_2D;
        canvasNode.setParent(scene);
        const canvasTransform = canvasNode.addComponent(UITransform);
        canvasTransform.setContentSize(size.width, size.height);
        canvasTransform.setAnchorPoint(0.5, 0.5);
        canvasNode.setPosition(0, 0, 0);
        canvasNode.addComponent(Canvas);

        const uiCameraNode = new Node('UI Camera');
        uiCameraNode.layer = Layers.Enum.UI_2D;
        uiCameraNode.setParent(canvasNode);
        uiCameraNode.setPosition(0, 0, 1000);
        const uiCamera = uiCameraNode.addComponent(Camera);
        uiCamera.projection = Camera.ProjectionType.ORTHO;
        uiCamera.orthoHeight = size.height * 0.5;
        uiCamera.near = 0;
        uiCamera.far = 2000;
        uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        uiCamera.priority = 1;
        uiCamera.visibility = Layers.Enum.UI_2D;

        this.canvas = canvasNode;
        this.uiCamera = uiCamera;
        this.hudNode = this.createLabelNode(canvasNode, 'HUD', 20, 28);
        this.hud = this.hudNode.getComponent(Label);
        this.overlayNode = this.createLabelNode(canvasNode, 'Overlay', 30, 40);
        this.overlay = this.overlayNode.getComponent(Label);

        this.layoutUI();
        if (!this.uiLayoutBound) {
            this.uiLayoutBound = true;
            view.on('canvas-resize', this.layoutUI, this);
            view.on('design-resolution-changed', this.layoutUI, this);
        }
    }

    /** Keeps the UI camera and the label positions in sync with the visible area. */
    private layoutUI(): void {
        const size = view.getVisibleSize();
        if (this.uiCamera && this.uiCamera.isValid) {
            this.uiCamera.orthoHeight = size.height * 0.5;
        }
        if (this.canvas) {
            const canvasTransform = this.canvas.getComponent(UITransform);
            if (canvasTransform) {
                canvasTransform.setContentSize(size.width, size.height);
            }
        }
        if (this.hudNode) {
            this.hudNode.setPosition(0, size.height * 0.38, 0);
            const transform = this.hudNode.getComponent(UITransform);
            if (transform) {
                transform.setContentSize(size.width - 40, 90);
            }
        }
        if (this.overlayNode) {
            this.overlayNode.setPosition(0, 30, 0);
            const transform = this.overlayNode.getComponent(UITransform);
            if (transform) {
                transform.setContentSize(size.width - 120, 320);
            }
        }
    }

    private createLabelNode(parent: Node, name: string, fontSize: number, lineHeight: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(200, 80);
        const label = node.addComponent(Label);
        label.fontSize = fontSize;
        label.lineHeight = lineHeight;
        label.color = new Color(255, 255, 255, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.enableWrapText = true;
        return node;
    }

    // #endregion

    // #region runtime

    private updateCamera(): void {
        const camera = this.camera;
        if (!camera || !camera.isValid) {
            return;
        }
        const x = LANE_X[this.lane] * 0.3;
        camera.node.setWorldPosition(x, 7.2, -12.5);
        camera.node.lookAt(new Vec3(x * 0.5, 1, 16));
    }

    private updateHud(): void {
        if (!this.hud) {
            return;
        }
        this.hud.string = `SPEED ${Math.round(this.speed * 7)} km/h    OVERTAKES ${this.overtakes}    DISTANCE ${Math.floor(this.distance)} m\n`
            + 'A / D : CHANGE LANE        W / S : SPEED        SPACE : RESTART';
    }

    private showIntro(): void {
        if (!this.overlay) {
            return;
        }
        this.overlay.string = 'CAR KING\n\nOvertake the traffic on a three-lane road.\n'
            + 'A / D or LEFT / RIGHT to change lane.\nW / S to control speed.';
        this.scheduleOnce(() => {
            if (!this.gameOver && this.overlay) {
                this.overlay.string = '';
            }
        }, 4);
    }

    public update(dt: number): void {
        if (!this.player) {
            return;
        }
        this.player.setPosition(LANE_X[this.lane], 0, 0);

        if (!this.gameOver) {
            const travel = this.speed * dt;
            this.distance += travel;

            for (const mark of this.roadMarks) {
                const position = mark.position;
                let z = position.z - travel;
                if (z < -110) {
                    z += 280;
                }
                mark.setPosition(position.x, position.y, z);
            }

            for (const car of this.traffic) {
                car.z -= Math.max(2, this.speed - car.speed) * dt;
                if (car.z < -12) {
                    if (!car.passed) {
                        this.overtakes++;
                        car.passed = true;
                    }
                    car.lane = Math.floor(Math.random() * 3);
                    car.z = 155 + Math.random() * 80;
                    car.speed = 8 + Math.random() * 6;
                    car.passed = false;
                }
                car.node.setPosition(LANE_X[car.lane], 0, car.z);
                if (!this.gameOver && car.lane === this.lane && Math.abs(car.z) < 2.55) {
                    this.endGame();
                }
            }
        }

        this.updateCamera();
        this.updateHud();
    }

    // #endregion

    // #region input

    private bindInput(): void {
        if (this.inputBound) {
            return;
        }
        this.inputBound = true;
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.TOUCH_END, this.onTouch, this);
    }

    private unbindInput(): void {
        if (!this.inputBound) {
            return;
        }
        this.inputBound = false;
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.TOUCH_END, this.onTouch, this);
    }

    private onKeyDown(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.SPACE) {
            if (this.gameOver) {
                this.restart();
            }
            return;
        }
        if (this.gameOver) {
            return;
        }
        switch (event.keyCode) {
        case KeyCode.ARROW_LEFT:
        case KeyCode.KEY_A:
            this.changeLane(-1);
            break;
        case KeyCode.ARROW_RIGHT:
        case KeyCode.KEY_D:
            this.changeLane(1);
            break;
        case KeyCode.ARROW_UP:
        case KeyCode.KEY_W:
            this.speed = Math.min(MAX_SPEED, this.speed + 2);
            break;
        case KeyCode.ARROW_DOWN:
        case KeyCode.KEY_S:
            this.speed = Math.max(MIN_SPEED, this.speed - 2);
            break;
        default:
            break;
        }
    }

    private onTouch(event: EventTouch): void {
        if (this.gameOver) {
            this.restart();
            return;
        }
        this.changeLane(event.getLocationX() < view.getVisibleSize().width / 2 ? -1 : 1);
    }

    private changeLane(direction: number): void {
        this.lane = Math.max(0, Math.min(2, this.lane + direction));
    }

    private endGame(): void {
        if (this.gameOver) {
            return;
        }
        this.gameOver = true;
        if (this.overlay) {
            this.overlay.string = `CRASH!\n\nOvertakes: ${this.overtakes}\nDistance: ${Math.floor(this.distance)} m\n\nPress SPACE to restart.`;
        }
        console.info('[CarKing] crash', {
            lane: this.lane,
            distance: Math.floor(this.distance),
            overtakes: this.overtakes,
        });
    }

    // #endregion
}
