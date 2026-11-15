import {
    _decorator,
    assetManager,
    Camera,
    Canvas,
    Color,
    Component,
    DirectionalLight,
    director,
    EffectAsset,
    Graphics,
    HorizontalTextAlignment,
    Label,
    Layers,
    Material,
    Mesh,
    MeshRenderer,
    Node,
    primitives,
    profiler,
    Scene,
    Tween,
    tween,
    UITransform,
    utils,
    Vec3,
    view,
} from 'cc';

const { ccclass } = _decorator;

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const PBR_EFFECT_UUID = 'c8f66d17-351a-48da-a12c-0212d28575c4';
const PBR_EFFECT_NAME = 'builtin-standard';
const UNLIT_EFFECT_NAME = 'builtin-unlit';

/** 每名角色的总血量 */
const MAX_HP = 5;
/** 左右两侧角色的站位 */
const HOME_X = 2.9;
/** 出手瞬间两人中心的距离 */
const ATTACK_GAP = 1.45;

const PANEL_WIDTH = 336;
const PANEL_HEIGHT = 104;
const BAR_WIDTH = 296;
const BAR_HEIGHT = 18;

const CAMERA_POSITION = new Vec3(0, 3.05, -7.6);
const CAMERA_LOOK_AT = new Vec3(0, 1.15, 0);

/** 只使用引擎内置 easing 名称的子集，避免额外汇入 TweenEasing */
type EasingName =
    | 'linear'
    | 'quadIn'
    | 'quadOut'
    | 'quadInOut'
    | 'sineIn'
    | 'sineOut'
    | 'sineInOut'
    | 'cubicIn'
    | 'cubicOut'
    | 'cubicInOut'
    | 'backOut'
    | 'elasticOut';

type Side = 'A' | 'B';

interface FighterPalette {
    readonly base: string;
    readonly dark: string;
}

interface FighterRig {
    readonly side: Side;
    readonly homeX: number;
    readonly facing: number;
    readonly root: Node;
    readonly hips: Node;
    readonly swordArm: Node;
    readonly legs: Node[];
}

interface FighterHud {
    readonly mirror: boolean;
    readonly panel: Node;
    readonly bar: Graphics;
    readonly nameLabel: Label;
    readonly hpLabel: Label;
}

/** 材质名称 → 颜色 */
const MATERIAL_COLORS: Record<string, Color> = {
    floor: new Color(56, 64, 90, 255),
    wall: new Color(36, 42, 62, 255),
    pillar: new Color(76, 84, 112, 255),
    line: new Color(228, 208, 150, 255),
    gold: new Color(214, 176, 92, 255),
    blue: new Color(72, 124, 205, 255),
    blueDark: new Color(40, 70, 122, 255),
    red: new Color(198, 78, 74, 255),
    redDark: new Color(120, 44, 48, 255),
    skin: new Color(232, 196, 160, 255),
    dark: new Color(32, 34, 44, 255),
    steel: new Color(200, 206, 218, 255),
    hit: new Color(255, 238, 150, 255),
    flame: new Color(255, 158, 58, 255),
    shadow: new Color(33, 37, 50, 255),
};

/* ------------------------------------------------------------------ */
/* 主元件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 一场「你一下、我一下」的回合对战：
 * A 向右走到 B 面前挥剑，然后退回原位；接着 B 向左走到 A 面前挥剑，再退回原位。
 * 两人轮流出手，直到一方血量耗尽；结算后血量重置，继续下一轮。
 */
@ccclass('DuelGame')
export class DuelGame extends Component {
    private readonly materials = new Map<string, Material>();
    private readonly meshes = new Map<string, Mesh>();
    private readonly fighters: FighterRig[] = [];
    private readonly huds: FighterHud[] = [];
    private readonly flames: Node[] = [];
    private readonly hp: number[] = [MAX_HP, MAX_HP];

    private world: Node | null = null;
    private canvas: Node | null = null;
    private camera: Camera | null = null;
    private uiCamera: Camera | null = null;

    private titleNode: Node | null = null;
    private subtitleNode: Node | null = null;
    private logNode: Node | null = null;
    private logBackdrop: Node | null = null;
    private logLabel: Label | null = null;
    private overlayNode: Node | null = null;
    private overlayLabel: Label | null = null;

    private round = 1;
    private elapsed = 0;
    private ready = false;
    private layoutBound = false;
    private booting = false;

    /* -------------------------------------------------------------- */
    /* 生命周期                                                        */
    /* -------------------------------------------------------------- */

    protected onLoad(): void {
        if (this.booting) {
            return;
        }
        this.booting = true;
        // 调试构建默认会叠加 fps/draw call 面板，这里关掉以免挡住画面
        profiler.hideStats();
        void this.boot();
    }

    protected update(dt: number): void {
        this.elapsed += dt;
        if (this.flames.length === 0) {
            return;
        }
        for (let i = 0; i < this.flames.length; i++) {
            const flame = this.flames[i];
            if (!flame.isValid) {
                continue;
            }
            const phase = this.elapsed * 9 + i * 2.1;
            flame.setScale(
                1 + Math.sin(phase) * 0.12,
                1 + Math.sin(phase * 1.7) * 0.16,
                1 + Math.cos(phase * 1.3) * 0.12,
            );
            flame.setRotationFromEuler(0, Math.sin(phase * 0.6) * 14, 0);
        }
    }

    protected onDestroy(): void {
        this.ready = false;
        this.unscheduleAllCallbacks();
        if (this.layoutBound) {
            view.off('canvas-resize', this.layoutUI, this);
            view.off('design-resolution-changed', this.layoutUI, this);
            this.layoutBound = false;
        }
        for (const material of this.materials.values()) {
            material.destroy();
        }
        this.materials.clear();
        for (const mesh of this.meshes.values()) {
            mesh.destroy();
        }
        this.meshes.clear();
    }

    private async boot(): Promise<void> {
        try {
            await this.ensurePbrEffect();
        } catch (error) {
            console.warn('[DuelGame] builtin-standard 载入失败，改用 unlit 材质。', error);
        }
        if (!this.isValid) {
            return;
        }
        try {
            this.buildGame();
        } catch (error) {
            console.error('[DuelGame] 建立场景失败：', error);
        }
    }

    /** 等待内置 PBR effect 就绪（载入失败时 3 秒后放弃，改用 fallback 材质） */
    private ensurePbrEffect(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (EffectAsset.get(PBR_EFFECT_NAME)) {
                resolve();
                return;
            }
            let timer = 0;
            let settled = false;
            const finish = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve();
            };
            timer = setTimeout(finish, 3000);
            assetManager.loadAny(PBR_EFFECT_UUID, (error: Error | null) => {
                if (error) {
                    console.warn('[DuelGame] 载入 builtin-standard 失败：', error);
                }
                finish();
            });
        });
    }

    /* -------------------------------------------------------------- */
    /* 场景搭建                                                        */
    /* -------------------------------------------------------------- */

    private buildGame(): void {
        const scene = director.getScene();
        if (!scene || !scene.isValid) {
            return;
        }

        const world = new Node('Duel World');
        world.layer = Layers.Enum.DEFAULT;
        scene.addChild(world);
        this.world = world;

        this.ensureCamera(scene);
        this.ensureLight(scene);
        this.buildArena(world);

        const blue: FighterPalette = { base: 'blue', dark: 'blueDark' };
        const red: FighterPalette = { base: 'red', dark: 'redDark' };
        this.fighters[0] = this.buildFighter(world, 'A', HOME_X, -1, blue);
        this.fighters[1] = this.buildFighter(world, 'B', -HOME_X, 1, red);

        this.createUI(scene);
        this.updateHuds();

        this.ready = true;
        this.round = 1;
        this.setLog('第 1 回合 — A 先攻！');
        void this.runBattle();
    }

    private ensureCamera(scene: Scene): void {
        const cameras = scene.getComponentsInChildren(Camera);
        let camera: Camera | null = null;
        for (const candidate of cameras) {
            if ((candidate.visibility & Layers.Enum.DEFAULT) !== 0) {
                camera = candidate;
                break;
            }
        }
        if (!camera) {
            const node = new Node('Duel Camera');
            node.layer = Layers.Enum.DEFAULT;
            scene.addChild(node);
            camera = node.addComponent(Camera);
        }

        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.fov = 45;
        camera.near = 0.1;
        camera.far = 200;
        camera.priority = 0;
        camera.visibility = Layers.Enum.DEFAULT;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(15, 18, 28, 255);
        camera.node.setPosition(CAMERA_POSITION);
        camera.node.lookAt(CAMERA_LOOK_AT);
        this.camera = camera;
    }

    private ensureLight(scene: Scene): void {
        const lights = scene.getComponentsInChildren(DirectionalLight);
        const light = lights.length > 0 ? lights[0] : null;
        if (!light) {
            return;
        }
        light.node.setPosition(3.2, 6.0, -4.5);
        light.node.lookAt(new Vec3(0, 0.8, 0.6));
        light.illuminance = 52000;
    }

    /** 场地：石台 + 背墙 + 立柱 + 火盆 */
    private buildArena(world: Node): void {
        this.box(world, 'Platform', new Vec3(14, 0.4, 7), new Vec3(0, -0.2, 0.4), 'floor');
        this.box(world, 'Rim Front', new Vec3(14.2, 0.1, 0.14), new Vec3(0, 0.02, -3.12), 'line');
        this.box(world, 'Rim Back', new Vec3(14.2, 0.1, 0.14), new Vec3(0, 0.02, 3.92), 'line');
        this.box(world, 'Rim Left', new Vec3(0.14, 0.1, 7.1), new Vec3(-7.06, 0.02, 0.4), 'line');
        this.box(world, 'Rim Right', new Vec3(0.14, 0.1, 7.1), new Vec3(7.06, 0.02, 0.4), 'line');
        this.box(world, 'Center Line', new Vec3(13.6, 0.02, 0.06), new Vec3(0, 0.012, 0.4), 'gold');

        this.box(world, 'Back Wall', new Vec3(16.5, 5.6, 0.5), new Vec3(0, 2.8, 4.45), 'wall');
        this.box(world, 'Wall Trim', new Vec3(16.6, 0.18, 0.6), new Vec3(0, 5.5, 4.45), 'gold');

        for (const x of [-5.8, 5.8]) {
            this.box(world, 'Pillar Base', new Vec3(0.95, 0.3, 0.95), new Vec3(x, 0.15, 3.85), 'line');
            this.box(world, 'Pillar', new Vec3(0.55, 4.4, 0.55), new Vec3(x, 2.2, 3.85), 'pillar');
            this.box(world, 'Pillar Cap', new Vec3(0.9, 0.24, 0.9), new Vec3(x, 4.52, 3.85), 'gold');
        }

        for (const x of [-4.1, 4.1]) {
            this.box(world, 'Brazier Stand', new Vec3(0.5, 1.0, 0.5), new Vec3(x, 0.5, 3.4), 'pillar');
            this.box(world, 'Brazier Bowl', new Vec3(0.9, 0.2, 0.9), new Vec3(x, 1.05, 3.4), 'gold');
            const flame = this.box(world, 'Flame', new Vec3(0.42, 0.6, 0.42), new Vec3(x, 1.45, 3.4), 'flame');
            this.flames.push(flame);
        }
    }

    /** 用方块堆出一个小人：头盔、躯干、双臂、双腿、长剑 */
    private buildFighter(world: Node, side: Side, homeX: number, facing: number, palette: FighterPalette): FighterRig {
        const root = new Node(`Fighter ${side}`);
        root.layer = Layers.Enum.DEFAULT;
        world.addChild(root);
        root.setPosition(homeX, 0, 0);

        // 脚下的假阴影（没有开启即时阴影，用深色薄片代替）
        this.box(root, 'Shadow', new Vec3(1.45, 0.02, 0.9), new Vec3(0, 0.012, 0), 'shadow');

        const hips = new Node('Hips');
        hips.layer = Layers.Enum.DEFAULT;
        root.addChild(hips);
        hips.setPosition(0, 0.84, 0);

        this.box(hips, 'Torso', new Vec3(0.62, 0.78, 0.42), new Vec3(0, 0.38, 0), palette.base);
        this.box(hips, 'Belt', new Vec3(0.66, 0.12, 0.44), new Vec3(0, 0.02, 0), 'gold');
        this.box(hips, 'Chest Plate', new Vec3(0.3, 0.3, 0.05), new Vec3(0, 0.44, -0.23), 'gold');

        // 头
        const head = new Node('Head');
        head.layer = Layers.Enum.DEFAULT;
        hips.addChild(head);
        head.setPosition(0, 1.0, 0);
        this.box(head, 'Face', new Vec3(0.4, 0.4, 0.4), Vec3.ZERO, 'skin');
        this.box(head, 'Helmet', new Vec3(0.46, 0.16, 0.46), new Vec3(0, 0.2, 0), 'steel');
        this.box(head, 'Crest', new Vec3(0.08, 0.2, 0.36), new Vec3(0, 0.3, 0), palette.base);
        this.box(head, 'Eye Left', new Vec3(0.08, 0.06, 0.04), new Vec3(-0.09, 0.02, -0.205), 'dark');
        this.box(head, 'Eye Right', new Vec3(0.08, 0.06, 0.04), new Vec3(0.09, 0.02, -0.205), 'dark');

        // 肩甲
        this.box(hips, 'Shoulder Pad L', new Vec3(0.22, 0.18, 0.42), new Vec3(-0.42, 0.64, 0), palette.dark);
        this.box(hips, 'Shoulder Pad R', new Vec3(0.22, 0.18, 0.42), new Vec3(0.42, 0.64, 0), palette.dark);

        // 持剑手（面向对手那一侧）
        const swordArm = new Node('Sword Arm');
        swordArm.layer = Layers.Enum.DEFAULT;
        hips.addChild(swordArm);
        swordArm.setPosition(facing * 0.44, 0.63, 0);
        this.box(swordArm, 'Sword Upper Arm', new Vec3(0.16, 0.52, 0.16), new Vec3(0, -0.26, 0), palette.dark);
        this.box(swordArm, 'Sword Glove', new Vec3(0.19, 0.16, 0.19), new Vec3(0, -0.56, 0), 'dark');
        this.box(swordArm, 'Hilt', new Vec3(0.07, 0.2, 0.07), new Vec3(0, -0.7, 0), 'dark');
        this.box(swordArm, 'Guard', new Vec3(0.34, 0.07, 0.1), new Vec3(0, -0.81, 0), 'gold');
        this.box(swordArm, 'Blade', new Vec3(0.09, 0.58, 0.14), new Vec3(0, -1.12, 0), 'steel');

        // 持盾手
        const shieldArm = new Node('Shield Arm');
        shieldArm.layer = Layers.Enum.DEFAULT;
        hips.addChild(shieldArm);
        shieldArm.setPosition(-facing * 0.44, 0.63, 0);
        this.box(shieldArm, 'Shield Upper Arm', new Vec3(0.16, 0.52, 0.16), new Vec3(0, -0.26, 0), palette.dark);
        this.box(shieldArm, 'Shield Glove', new Vec3(0.19, 0.16, 0.19), new Vec3(0, -0.56, 0), 'dark');
        this.box(shieldArm, 'Shield', new Vec3(0.44, 0.56, 0.07), new Vec3(0, -0.4, -0.17), palette.base);
        this.box(shieldArm, 'Shield Boss', new Vec3(0.1, 0.1, 0.04), new Vec3(0, -0.4, -0.21), 'gold');

        // 双腿
        const legs: Node[] = [];
        for (let i = 0; i < 2; i++) {
            const leg = new Node(`Leg ${i === 0 ? 'Front' : 'Back'}`);
            leg.layer = Layers.Enum.DEFAULT;
            root.addChild(leg);
            leg.setPosition((i === 0 ? 1 : -1) * 0.17, 0.84, 0);
            this.box(leg, 'Thigh', new Vec3(0.22, 0.8, 0.26), new Vec3(0, -0.4, 0), palette.dark);
            this.box(leg, 'Boot', new Vec3(0.4, 0.16, 0.24), new Vec3(facing * 0.06, -0.76, 0), 'dark');
            legs.push(leg);
        }

        return { side, homeX, facing, root, hips, swordArm, legs };
    }

    /* -------------------------------------------------------------- */
    /* UI                                                              */
    /* -------------------------------------------------------------- */

    private createUI(scene: Scene): void {
        const size = view.getVisibleSize();

        const canvasNode = new Node('Duel Canvas');
        canvasNode.layer = Layers.Enum.UI_2D;
        scene.addChild(canvasNode);
        const canvasTransform = canvasNode.addComponent(UITransform);
        canvasTransform.setContentSize(size.width, size.height);
        canvasTransform.setAnchorPoint(0.5, 0.5);
        canvasNode.setPosition(0, 0, 0);
        const canvas = canvasNode.addComponent(Canvas);
        this.canvas = canvasNode;

        const uiCameraNode = new Node('UI Camera');
        uiCameraNode.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(uiCameraNode);
        uiCameraNode.setPosition(0, 0, 1000);
        const uiCamera = uiCameraNode.addComponent(Camera);
        uiCamera.projection = Camera.ProjectionType.ORTHO;
        uiCamera.orthoHeight = size.height * 0.5;
        uiCamera.near = 0;
        uiCamera.far = 2000;
        uiCamera.priority = 1;
        uiCamera.visibility = Layers.Enum.UI_2D;
        uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        this.uiCamera = uiCamera;
        canvas.cameraComponent = uiCamera;

        const title = this.labelNode(canvasNode, 'Title', 34, {
            width: 720,
            height: 52,
            bold: true,
            color: new Color(244, 234, 210, 255),
        });
        title.label.string = '回合对战 DEMO';
        this.titleNode = title.node;

        const subtitle = this.labelNode(canvasNode, 'Subtitle', 16, {
            width: 900,
            height: 30,
            color: new Color(168, 178, 198, 255),
        });
        subtitle.label.string = 'A 前进攻击 B，B 再前进攻击 A，循环往复';
        this.subtitleNode = subtitle.node;

        const logBackdrop = new Node('Battle Log Backdrop');
        logBackdrop.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(logBackdrop);
        const logBackdropTransform = logBackdrop.addComponent(UITransform);
        logBackdropTransform.setContentSize(620, 44);
        logBackdropTransform.setAnchorPoint(0.5, 0.5);
        const logBackdropGraphics = logBackdrop.addComponent(Graphics);
        logBackdropGraphics.fillColor = new Color(10, 12, 20, 190);
        logBackdropGraphics.roundRect(-310, -22, 620, 44, 12);
        logBackdropGraphics.fill();
        this.logBackdrop = logBackdrop;

        const log = this.labelNode(canvasNode, 'Battle Log', 22, {
            width: 900,
            height: 40,
            color: new Color(236, 241, 250, 255),
        });
        this.logNode = log.node;
        this.logLabel = log.label;

        // 回合结算浮层
        const overlay = new Node('Round Result');
        overlay.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(overlay);
        const overlayTransform = overlay.addComponent(UITransform);
        overlayTransform.setContentSize(520, 110);

        const backdrop = new Node('Backdrop');
        backdrop.layer = Layers.Enum.UI_2D;
        overlay.addChild(backdrop);
        const backdropTransform = backdrop.addComponent(UITransform);
        backdropTransform.setContentSize(520, 110);
        const backdropGraphics = backdrop.addComponent(Graphics);
        backdropGraphics.fillColor = new Color(10, 12, 20, 215);
        backdropGraphics.roundRect(-260, -55, 520, 110, 16);
        backdropGraphics.fill();
        backdropGraphics.lineWidth = 2;
        backdropGraphics.strokeColor = new Color(214, 176, 92, 200);
        backdropGraphics.roundRect(-260, -55, 520, 110, 16);
        backdropGraphics.stroke();

        const overlayLabel = this.labelNode(overlay, 'Result Text', 44, {
            width: 480,
            height: 80,
            bold: true,
            color: new Color(240, 196, 84, 255),
        });
        overlayLabel.label.string = '';
        this.overlayNode = overlay;
        this.overlayLabel = overlayLabel.label;
        overlay.active = false;

        this.huds[0] = this.createHud(canvasNode, 'A', false);
        this.huds[1] = this.createHud(canvasNode, 'B', true);

        this.layoutUI();
        if (!this.layoutBound) {
            this.layoutBound = true;
            view.on('canvas-resize', this.layoutUI, this);
            view.on('design-resolution-changed', this.layoutUI, this);
        }
    }

    private labelNode(
        parent: Node,
        name: string,
        fontSize: number,
        options: {
            width: number;
            height: number;
            bold?: boolean;
            color?: Color;
            align?: HorizontalTextAlignment;
            anchorX?: number;
            wrap?: boolean;
        },
    ): { node: Node; label: Label } {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(options.width, options.height);
        if (options.anchorX !== undefined) {
            transform.setAnchorPoint(options.anchorX, 0.5);
        }
        const label = node.addComponent(Label);
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.32);
        label.color = options.color ?? new Color(236, 241, 250, 255);
        label.horizontalAlign = options.align ?? HorizontalTextAlignment.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.enableWrapText = options.wrap ?? true;
        if (options.bold) {
            label.isBold = true;
        }
        return { node, label };
    }

    private createHud(canvas: Node, side: Side, mirror: boolean): FighterHud {
        const panel = new Node(`HUD ${side}`);
        panel.layer = Layers.Enum.UI_2D;
        canvas.addChild(panel);
        const panelTransform = panel.addComponent(UITransform);
        panelTransform.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);

        const background = new Node('Panel Background');
        background.layer = Layers.Enum.UI_2D;
        panel.addChild(background);
        const backgroundTransform = background.addComponent(UITransform);
        backgroundTransform.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
        const backgroundGraphics = background.addComponent(Graphics);
        backgroundGraphics.fillColor = new Color(10, 14, 24, 178);
        backgroundGraphics.roundRect(-PANEL_WIDTH / 2, -PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT, 12);
        backgroundGraphics.fill();
        backgroundGraphics.lineWidth = 2;
        backgroundGraphics.strokeColor = new Color(96, 110, 138, 150);
        backgroundGraphics.roundRect(-PANEL_WIDTH / 2, -PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT, 12);
        backgroundGraphics.stroke();

        const nameLabel = this.labelNode(panel, 'Name', 26, {
            width: 160,
            height: 34,
            bold: true,
            align: mirror ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.LEFT,
            anchorX: mirror ? 1 : 0,
            color: side === 'A' ? new Color(120, 168, 235, 255) : new Color(235, 132, 126, 255),
        });
        nameLabel.node.setPosition(mirror ? PANEL_WIDTH / 2 - 20 : -PANEL_WIDTH / 2 + 20, 26, 0);
        nameLabel.label.string = side;

        const hpLabel = this.labelNode(panel, 'HP', 20, {
            width: 200,
            height: 34,
            align: mirror ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.RIGHT,
            anchorX: mirror ? 0 : 1,
            color: new Color(198, 208, 226, 255),
        });
        hpLabel.node.setPosition(mirror ? -PANEL_WIDTH / 2 + 20 : PANEL_WIDTH / 2 - 20, 26, 0);
        hpLabel.label.string = `${MAX_HP} / ${MAX_HP}`;

        const barNode = new Node('HP Bar');
        barNode.layer = Layers.Enum.UI_2D;
        panel.addChild(barNode);
        barNode.setPosition(-PANEL_WIDTH / 2 + 20, -PANEL_HEIGHT / 2 + 16, 0);
        const barTransform = barNode.addComponent(UITransform);
        barTransform.setContentSize(BAR_WIDTH, BAR_HEIGHT);
        const bar = barNode.addComponent(Graphics);

        return { mirror, panel, bar, nameLabel: nameLabel.label, hpLabel: hpLabel.label };
    }

    private layoutUI(): void {
        if (!this.canvas) {
            return;
        }
        const size = view.getVisibleSize();
        const halfWidth = size.width * 0.5;
        const halfHeight = size.height * 0.5;
        const canvasTransform = this.canvas.getComponent(UITransform);
        canvasTransform?.setContentSize(size.width, size.height);
        if (this.uiCamera) {
            this.uiCamera.orthoHeight = halfHeight;
        }

        this.titleNode?.setPosition(0, halfHeight - 48, 0);
        this.subtitleNode?.setPosition(0, halfHeight - 88, 0);
        this.logNode?.setPosition(0, -halfHeight + 82, 0);
        this.logBackdrop?.setPosition(0, -halfHeight + 82, 0);
        this.overlayNode?.setPosition(0, 30, 0);
        this.huds[0]?.panel.setPosition(-halfWidth + PANEL_WIDTH / 2 + 26, halfHeight - 168, 0);
        this.huds[1]?.panel.setPosition(halfWidth - PANEL_WIDTH / 2 - 26, halfHeight - 168, 0);
    }

    private updateHuds(): void {
        for (let i = 0; i < this.huds.length; i++) {
            const hud = this.huds[i];
            if (!hud) {
                continue;
            }
            const hp = this.hp[i];
            hud.hpLabel.string = `${hp} / ${MAX_HP}`;
            this.drawHpBar(hud, hp);
        }
    }

    private drawHpBar(hud: FighterHud, hp: number): void {
        const graphics = hud.bar;
        graphics.clear();

        graphics.fillColor = new Color(12, 16, 26, 210);
        graphics.roundRect(0, 0, BAR_WIDTH, BAR_HEIGHT, 5);
        graphics.fill();

        const ratio = Math.max(0, Math.min(1, hp / MAX_HP));
        const innerWidth = (BAR_WIDTH - 4) * ratio;
        if (innerWidth > 1) {
            graphics.fillColor = ratio < 0.34
                ? new Color(240, 110, 70, 255)
                : (hud.mirror ? new Color(214, 92, 88, 255) : new Color(96, 148, 220, 255));
            const x = hud.mirror ? BAR_WIDTH - 2 - innerWidth : 2;
            graphics.roundRect(x, 2, innerWidth, BAR_HEIGHT - 4, 3);
            graphics.fill();
        }
    }

    private setLog(text: string): void {
        if (this.logLabel) {
            this.logLabel.string = text;
        }
    }

    /* -------------------------------------------------------------- */
    /* 战斗流程                                                        */
    /* -------------------------------------------------------------- */

    private async runBattle(): Promise<void> {
        while (this.isValid && this.ready) {
            for (let attackerIndex = 0; attackerIndex < 2; attackerIndex++) {
                if (!this.isValid || !this.ready) {
                    return;
                }
                await this.performAttack(attackerIndex);
                if (!this.isValid || !this.ready) {
                    return;
                }

                const defenderIndex = 1 - attackerIndex;
                if (this.hp[defenderIndex] <= 0) {
                    await this.finishBout(attackerIndex);
                    break;
                }
                await this.delay(480);
            }
            await this.delay(120);
        }
    }

    private async performAttack(attackerIndex: number): Promise<void> {
        const attacker = this.fighters[attackerIndex];
        const defender = this.fighters[1 - attackerIndex];
        if (!attacker || !defender) {
            return;
        }

        Tween.stopAllByTarget(attacker.root);
        Tween.stopAllByTarget(attacker.swordArm);

        const defenderX = defender.root.position.x;
        const approachX = defenderX - attacker.facing * ATTACK_GAP * 1.35;
        this.setLog(`${attacker.side} 前进，准备攻击 ${defender.side}`);

        // 1. 走到对手面前
        this.startWalk(attacker);
        await this.moveFighter(attacker, approachX, 0.62, 'quadOut');
        this.stopWalk(attacker);
        if (!this.isValid) {
            return;
        }

        // 2. 举剑蓄力
        await this.delay(90);
        await this.swingArm(attacker, -attacker.facing * 92, 0.2, 'quadOut');
        if (!this.isValid) {
            return;
        }

        // 3. 前冲挥剑
        await this.delay(70);
        const lungeX = defenderX - attacker.facing * ATTACK_GAP;
        const lunge = this.moveFighter(attacker, lungeX, 0.14, 'quadIn');
        const swing = this.swingArm(attacker, attacker.facing * 64, 0.14, 'quadIn');
        await Promise.all([lunge, swing]);
        if (!this.isValid) {
            return;
        }

        // 4. 命中判定 + 打击特效
        const gap = Math.abs(defender.root.position.x - attacker.root.position.x);
        this.spawnHitEffect(defender.root.position.x - attacker.facing * 0.32, 1.24);
        if (gap <= 2.3) {
            this.hp[1 - attackerIndex] = Math.max(0, this.hp[1 - attackerIndex] - 1);
            this.updateHuds();
            this.reactDefender(defender, attacker.facing);
            this.shakeCamera(0.06);
            this.setLog(`${attacker.side} 命中 ${defender.side}！${defender.side} 剩余 HP ${this.hp[1 - attackerIndex]} / ${MAX_HP}`);
        } else {
            this.setLog(`${attacker.side} 的攻击落空`);
        }

        // 5. 收剑、退回原位
        await this.delay(150);
        await this.swingArm(attacker, 0, 0.24, 'quadInOut');
        if (!this.isValid) {
            return;
        }
        this.startWalk(attacker);
        await this.moveFighter(attacker, attacker.homeX, 0.58, 'quadInOut');
        this.stopWalk(attacker);
    }

    private async finishBout(winnerIndex: number): Promise<void> {
        const winner = this.fighters[winnerIndex];
        const loser = this.fighters[1 - winnerIndex];
        if (!winner || !loser) {
            return;
        }

        this.setLog(`第 ${this.round} 回合结束 — ${winner.side} 获胜！`);
        if (this.overlayNode && this.overlayLabel) {
            this.overlayLabel.string = `${winner.side} 胜利！`;
            this.overlayNode.active = true;
            this.overlayNode.setScale(0.6, 0.6, 1);
            tween(this.overlayNode)
                .to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        }

        // 败者倒地
        Tween.stopAllByTarget(loser.root);
        Tween.stopAllByTarget(loser.swordArm);
        tween(loser.root)
            .to(0.5, {
                eulerAngles: new Vec3(0, 0, loser.facing * 84),
                position: new Vec3(loser.root.position.x, -0.12, 0),
            }, { easing: 'quadIn' })
            .start();

        // 胜者举剑
        tween(winner.swordArm)
            .to(0.32, { eulerAngles: new Vec3(0, 0, -winner.facing * 150) }, { easing: 'backOut' })
            .start();

        await this.delay(2600);
        if (!this.isValid) {
            return;
        }
        if (this.overlayNode) {
            this.overlayNode.active = false;
        }
        this.resetBout();
    }

    private resetBout(): void {
        this.round += 1;
        for (let i = 0; i < this.fighters.length; i++) {
            const fighter = this.fighters[i];
            if (!fighter) {
                continue;
            }
            Tween.stopAllByTarget(fighter.root);
            Tween.stopAllByTarget(fighter.hips);
            Tween.stopAllByTarget(fighter.swordArm);
            for (const leg of fighter.legs) {
                Tween.stopAllByTarget(leg);
            }
            fighter.root.setPosition(fighter.homeX, 0, 0);
            fighter.root.setRotationFromEuler(0, 0, 0);
            fighter.root.setScale(1, 1, 1);
            fighter.hips.setPosition(0, 0.84, 0);
            fighter.swordArm.setRotationFromEuler(0, 0, 0);
            for (const leg of fighter.legs) {
                leg.setRotationFromEuler(0, 0, 0);
            }
            this.hp[i] = MAX_HP;
        }
        this.updateHuds();
        this.setLog(`第 ${this.round} 回合 — A 先攻！`);
    }

    /* -------------------------------------------------------------- */
    /* 动作辅助                                                        */
    /* -------------------------------------------------------------- */

    private startWalk(fighter: FighterRig): void {
        this.stopWalk(fighter);
        const [front, back] = fighter.legs;
        const step = 0.16;
        if (front) {
            tween(front)
                .to(step, { eulerAngles: new Vec3(24, 0, 0) }, { easing: 'sineInOut' })
                .to(step, { eulerAngles: new Vec3(-24, 0, 0) }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
        }
        if (back) {
            tween(back)
                .to(step, { eulerAngles: new Vec3(-24, 0, 0) }, { easing: 'sineInOut' })
                .to(step, { eulerAngles: new Vec3(24, 0, 0) }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
        }
        tween(fighter.hips)
            .to(step * 2, { position: new Vec3(0, 0.88, 0) }, { easing: 'sineInOut' })
            .to(step * 2, { position: new Vec3(0, 0.84, 0) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private stopWalk(fighter: FighterRig): void {
        Tween.stopAllByTarget(fighter.hips);
        fighter.hips.setPosition(0, 0.84, 0);
        for (const leg of fighter.legs) {
            Tween.stopAllByTarget(leg);
            leg.setRotationFromEuler(0, 0, 0);
        }
    }

    private moveFighter(fighter: FighterRig, x: number, duration: number, easing: EasingName): Promise<void> {
        return new Promise<void>((resolve) => {
            tween(fighter.root)
                .to(duration, { position: new Vec3(x, fighter.root.position.y, fighter.root.position.z) }, { easing })
                .call(() => resolve())
                .start();
        });
    }

    private swingArm(fighter: FighterRig, degrees: number, duration: number, easing: EasingName): Promise<void> {
        return new Promise<void>((resolve) => {
            tween(fighter.swordArm)
                .to(duration, { eulerAngles: new Vec3(0, 0, degrees) }, { easing })
                .call(() => resolve())
                .start();
        });
    }

    private reactDefender(defender: FighterRig, facing: number): void {
        const x = defender.root.position.x;
        Tween.stopAllByTarget(defender.root);
        tween(defender.root)
            .to(0.08, { position: new Vec3(x + facing * 0.2, 0, 0) }, { easing: 'quadOut' })
            .to(0.18, { position: new Vec3(x, 0, 0) }, { easing: 'quadInOut' })
            .start();
    }

    private shakeCamera(strength: number): void {
        const node = this.camera?.node;
        if (!node || !node.isValid) {
            return;
        }
        Tween.stopAllByTarget(node);
        node.setPosition(CAMERA_POSITION);
        tween(node)
            .to(0.05, { position: new Vec3(CAMERA_POSITION.x + strength, CAMERA_POSITION.y + strength * 0.4, CAMERA_POSITION.z) }, { easing: 'sineOut' })
            .to(0.07, { position: new Vec3(CAMERA_POSITION.x - strength * 0.8, CAMERA_POSITION.y - strength * 0.3, CAMERA_POSITION.z) }, { easing: 'sineInOut' })
            .to(0.06, { position: CAMERA_POSITION.clone() }, { easing: 'sineOut' })
            .call(() => {
                node.setPosition(CAMERA_POSITION);
                node.lookAt(CAMERA_LOOK_AT);
            })
            .start();
    }

    /** 命中特效：闪光 + 横向刀光 + 火花 + 地面扩散的光环 */
    private spawnHitEffect(x: number, y: number): void {
        const world = this.world;
        if (!world || !world.isValid) {
            return;
        }

        const flash = this.box(world, 'Hit Flash', new Vec3(0.24, 0.24, 0.24), new Vec3(x, y, 0), 'hit');
        tween(flash)
            .to(0.07, { scale: new Vec3(1.7, 1.7, 1.7) }, { easing: 'quadOut' })
            .to(0.13, { scale: new Vec3(0, 0, 0) }, { easing: 'quadIn' })
            .call(() => flash.destroy())
            .start();

        const streak = this.box(world, 'Hit Streak', new Vec3(0.9, 0.07, 0.07), new Vec3(x, y + 0.08, 0), 'gold');
        tween(streak)
            .to(0.09, { scale: new Vec3(1.3, 1, 1) }, { easing: 'quadOut' })
            .to(0.12, { scale: new Vec3(0, 0, 0) }, { easing: 'quadIn' })
            .call(() => streak.destroy())
            .start();

        for (let i = 0; i < 7; i++) {
            const spark = this.box(world, `Spark ${i}`, new Vec3(0.11, 0.11, 0.11), new Vec3(x, y, 0), i % 2 === 0 ? 'hit' : 'gold');
            const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
            const distance = 0.55 + Math.random() * 0.5;
            const target = new Vec3(
                x + Math.cos(angle) * distance,
                y + Math.sin(angle) * distance,
                (Math.random() - 0.5) * 0.4,
            );
            tween(spark)
                .to(0.26, { position: target, scale: new Vec3(0, 0, 0) }, { easing: 'quadOut' })
                .call(() => spark.destroy())
                .start();
        }

        // 地面光环用四根细条围成方框，避免整块方片盖住地面
        const ring = new Node('Shockwave');
        ring.layer = Layers.Enum.DEFAULT;
        world.addChild(ring);
        ring.setPosition(x, 0.03, 0);
        const arm = 0.7;
        const thickness = 0.07;
        this.box(ring, 'Wave Near', new Vec3(arm, 0.02, thickness), new Vec3(0, 0, -arm * 0.5), 'gold');
        this.box(ring, 'Wave Far', new Vec3(arm, 0.02, thickness), new Vec3(0, 0, arm * 0.5), 'gold');
        this.box(ring, 'Wave Left', new Vec3(thickness, 0.02, arm), new Vec3(-arm * 0.5, 0, 0), 'gold');
        this.box(ring, 'Wave Right', new Vec3(thickness, 0.02, arm), new Vec3(arm * 0.5, 0, 0), 'gold');
        tween(ring)
            .to(0.24, { scale: new Vec3(1.9, 1, 1.9) }, { easing: 'quadOut' })
            .call(() => ring.destroy())
            .start();
    }

    /* -------------------------------------------------------------- */
    /* 基础工具                                                        */
    /* -------------------------------------------------------------- */

    private material(key: string): Material {
        const cached = this.materials.get(key);
        if (cached) {
            return cached;
        }
        const color = MATERIAL_COLORS[key];
        if (!color) {
            throw new Error(`未知的材质名称：${key}`);
        }
        const material = this.createMaterial(color);
        this.materials.set(key, material);
        return material;
    }

    private createMaterial(color: Color): Material {
        const material = new Material();
        try {
            material.initialize({ effectName: PBR_EFFECT_NAME });
            if (material.passes.length > 0) {
                material.setProperty('albedo', color);
                material.setProperty('roughness', 0.72);
                material.setProperty('metallic', 0.04);
                return material;
            }
        } catch (error) {
            // PBR 不可用时走下面的 unlit fallback
        }

        const fallback = new Material();
        try {
            fallback.initialize({ effectName: UNLIT_EFFECT_NAME });
            fallback.setProperty('mainColor', color);
        } catch (error) {
            console.warn('[DuelGame] unlit 材质初始化失败：', error);
        }
        return fallback;
    }

    private getBoxMesh(size: Vec3): Mesh {
        const key = `${size.x}x${size.y}x${size.z}`;
        const cached = this.meshes.get(key);
        if (cached) {
            return cached;
        }
        const mesh = utils.createMesh(primitives.box({ width: size.x, height: size.y, length: size.z }));
        this.meshes.set(key, mesh);
        return mesh;
    }

    private box(parent: Node, name: string, size: Vec3, position: Vec3, materialKey: string): Node {
        if (!parent || !parent.isValid) {
            throw new Error(`建立方块「${name}」失败：父节点无效`);
        }
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        parent.addChild(node);
        node.setPosition(position);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = this.getBoxMesh(size);
        renderer.setMaterial(this.material(materialKey), 0);
        return node;
    }

    private delay(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.scheduleOnce(() => resolve(), ms / 1000);
        });
    }
}
