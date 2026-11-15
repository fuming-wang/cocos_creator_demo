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
/** 每队人数 */
const TEAM_SIZE = 4;
/** 左右两侧的站位（x 轴） */
const HOME_X = 2.78;
/** 每队 4 人的纵深站位（z 轴），从靠近镜头到靠近背墙 */
const FORMATION_Z: readonly number[] = [-1.7, -0.55, 0.6, 1.75];
/** 出手瞬间两人中心的距离 */
const ATTACK_GAP = 1.45;
/** 走到对手面前的停步距离 */
const APPROACH_GAP = 1.95;
/** 目标脚下光环的边长 */
const RING_SIZE = 1.72;

const PANEL_WIDTH = 260;
const PANEL_HEIGHT = 68;
const BAR_WIDTH = 236;
const BAR_HEIGHT = 12;
const PANEL_GAP = 8;
/** HUD 距屏幕上沿的距离（像素） */
const HUD_TOP = 106;

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

/** 光环的三种状态：隐藏 / 候选目标 / 已选定目标 */
type RingState = 'none' | 'candidate' | 'target';

interface FighterPalette {
    readonly base: string;
    readonly dark: string;
    readonly accent: Color;
}

interface FighterRig {
    readonly side: Side;
    readonly slot: number;
    readonly name: string;
    readonly home: Vec3;
    readonly facing: number;
    readonly root: Node;
    readonly hips: Node;
    readonly swordArm: Node;
    readonly legs: Node[];
    /** 脚下的目标光环（固定在世界坐标，不随角色移动） */
    readonly ring: Node;
    hp: number;
    alive: boolean;
}

interface FighterHud {
    readonly mirror: boolean;
    readonly panel: Node;
    readonly bar: Graphics;
    readonly border: Graphics;
    readonly nameLabel: Label;
    readonly hpLabel: Label;
    readonly accent: Color;
}

const SIDE_LABEL: Record<Side, string> = { A: '蓝方', B: '红方' };

const BORDER_DEFAULT = new Color(96, 110, 138, 150);
const BORDER_DEAD = new Color(70, 74, 88, 120);
const BORDER_TARGET = new Color(240, 198, 96, 255);
const DEAD_TEXT = new Color(118, 122, 134, 255);
const BAR_LOW = new Color(240, 110, 70, 255);
const BAR_EMPTY = new Color(58, 62, 74, 255);

/** 材质名称 → 颜色 */
const MATERIAL_COLORS: Record<string, Color> = {
    floor: new Color(56, 64, 90, 255),
    wall: new Color(36, 42, 62, 255),
    pillar: new Color(76, 84, 112, 255),
    line: new Color(228, 208, 150, 255),
    gold: new Color(214, 176, 92, 255),
    blue: new Color(72, 124, 205, 255),
    blueDark: new Color(40, 70, 122, 255),
    sky: new Color(112, 178, 226, 255),
    skyDark: new Color(58, 112, 154, 255),
    cyan: new Color(72, 190, 200, 255),
    cyanDark: new Color(36, 116, 126, 255),
    indigo: new Color(108, 116, 214, 255),
    indigoDark: new Color(58, 62, 136, 255),
    red: new Color(198, 78, 74, 255),
    redDark: new Color(120, 44, 48, 255),
    orange: new Color(222, 138, 72, 255),
    orangeDark: new Color(134, 78, 40, 255),
    rose: new Color(220, 106, 142, 255),
    roseDark: new Color(128, 54, 80, 255),
    crimson: new Color(186, 62, 94, 255),
    crimsonDark: new Color(104, 30, 54, 255),
    skin: new Color(232, 196, 160, 255),
    dark: new Color(32, 34, 44, 255),
    steel: new Color(200, 206, 218, 255),
    hit: new Color(255, 238, 150, 255),
    flame: new Color(255, 158, 58, 255),
    shadow: new Color(33, 37, 50, 255),
};

/** 蓝方 4 人（深浅不同的蓝），红方 4 人（深浅不同的红） */
const PALETTES: Record<Side, readonly FighterPalette[]> = {
    A: [
        { base: 'blue', dark: 'blueDark', accent: new Color(120, 168, 235, 255) },
        { base: 'sky', dark: 'skyDark', accent: new Color(130, 200, 240, 255) },
        { base: 'cyan', dark: 'cyanDark', accent: new Color(110, 214, 222, 255) },
        { base: 'indigo', dark: 'indigoDark', accent: new Color(148, 156, 240, 255) },
    ],
    B: [
        { base: 'red', dark: 'redDark', accent: new Color(235, 132, 126, 255) },
        { base: 'orange', dark: 'orangeDark', accent: new Color(240, 172, 112, 255) },
        { base: 'rose', dark: 'roseDark', accent: new Color(240, 132, 166, 255) },
        { base: 'crimson', dark: 'crimsonDark', accent: new Color(222, 104, 132, 255) },
    ],
};

/* ------------------------------------------------------------------ */
/* 主元件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 4v4 回合对战：
 * 每回合双方 8 名角色按 A1 → B1 → A2 → B2 … 的顺序行动。
 * 每人行动前先「选择攻击目标」（存活敌人中挑选），锁定后用剑攻击，
 * 再退回原位；一方全员倒下后结算并重置，开始下一场。
 *
 * 目标选择策略见 pickTarget()：优先打残血，血量相同时打最近的。
 */
@ccclass('DuelGame')
export class DuelGame extends Component {
    private readonly materials = new Map<string, Material>();
    private readonly meshes = new Map<string, Mesh>();
    private readonly fighters: FighterRig[] = [];
    private readonly huds: FighterHud[] = [];
    private readonly flames: Node[] = [];

    private world: Node | null = null;
    private canvas: Node | null = null;
    private camera: Camera | null = null;
    private uiCamera: Camera | null = null;

    private titleNode: Node | null = null;
    private subtitleNode: Node | null = null;
    private teamLabelA: Node | null = null;
    private teamLabelB: Node | null = null;
    private roundBadge: Node | null = null;
    private roundLabel: Label | null = null;
    private logNode: Node | null = null;
    private logBackdrop: Node | null = null;
    private logLabel: Label | null = null;
    private overlayNode: Node | null = null;
    private overlayLabel: Label | null = null;

    /** 锁定目标时浮在目标头顶的旋转标记 */
    private reticle: Node | null = null;
    private readonly reticleBase = new Vec3();

    private battle = 1;
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
        if (this.flames.length > 0) {
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
        if (this.reticle && this.reticle.activeInHierarchy) {
            this.reticle.setRotationFromEuler(0, this.elapsed * 150, 0);
            this.reticle.setPosition(
                this.reticleBase.x,
                this.reticleBase.y + Math.sin(this.elapsed * 5) * 0.07,
                this.reticleBase.z,
            );
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

        for (const side of ['A', 'B'] as Side[]) {
            for (let slot = 0; slot < TEAM_SIZE; slot++) {
                const palette = PALETTES[side][slot];
                const x = side === 'A' ? HOME_X : -HOME_X;
                const facing = side === 'A' ? -1 : 1;
                const home = new Vec3(x, 0, FORMATION_Z[slot]);
                this.fighters.push(this.buildFighter(world, side, slot, home, facing, palette));
            }
        }

        this.reticle = this.buildReticle(world);

        this.createUI(scene);
        this.updateHuds();
        this.paintSelection(null, null);

        this.ready = true;
        this.battle = 1;
        this.round = 1;
        this.setRoundText();
        this.setLog('第 1 回合 — 双方列阵，依次选择目标');
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
    private buildFighter(
        world: Node,
        side: Side,
        slot: number,
        home: Vec3,
        facing: number,
        palette: FighterPalette,
    ): FighterRig {
        const name = `${side}${slot + 1}`;
        const root = new Node(`Fighter ${name}`);
        root.layer = Layers.Enum.DEFAULT;
        world.addChild(root);
        root.setPosition(home);

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

        const ring = this.buildRing(world, name, home);

        return { side, slot, name, home, facing, root, hips, swordArm, legs, ring, hp: MAX_HP, alive: true };
    }

    /** 脚下光环：四根细条围成方框，跟随站位固定在地面上 */
    private buildRing(world: Node, name: string, home: Vec3): Node {
        const ring = new Node(`Target Ring ${name}`);
        ring.layer = Layers.Enum.DEFAULT;
        world.addChild(ring);
        ring.setPosition(home.x, 0.045, home.z);
        const half = RING_SIZE * 0.5;
        const thickness = 0.09;
        this.box(ring, 'Ring Near', new Vec3(RING_SIZE, 0.02, thickness), new Vec3(0, 0, -half), 'line');
        this.box(ring, 'Ring Far', new Vec3(RING_SIZE, 0.02, thickness), new Vec3(0, 0, half), 'line');
        this.box(ring, 'Ring Left', new Vec3(thickness, 0.02, RING_SIZE), new Vec3(-half, 0, 0), 'line');
        this.box(ring, 'Ring Right', new Vec3(thickness, 0.02, RING_SIZE), new Vec3(half, 0, 0), 'line');
        ring.active = false;
        return ring;
    }

    /** 锁定目标后浮在头顶的标记：旋转方框 + 四角亮点 */
    private buildReticle(world: Node): Node {
        const node = new Node('Target Reticle');
        node.layer = Layers.Enum.DEFAULT;
        world.addChild(node);
        const size = 1.15;
        const half = size * 0.5;
        const thickness = 0.08;
        this.box(node, 'Reticle Near', new Vec3(size, 0.05, thickness), new Vec3(0, 0, -half), 'gold');
        this.box(node, 'Reticle Far', new Vec3(size, 0.05, thickness), new Vec3(0, 0, half), 'gold');
        this.box(node, 'Reticle Left', new Vec3(thickness, 0.05, size), new Vec3(-half, 0, 0), 'gold');
        this.box(node, 'Reticle Right', new Vec3(thickness, 0.05, size), new Vec3(half, 0, 0), 'gold');
        for (let i = 0; i < 4; i++) {
            const sx = i % 2 === 0 ? -1 : 1;
            const sz = i < 2 ? -1 : 1;
            this.box(
                node,
                `Reticle Corner ${i}`,
                new Vec3(0.14, 0.14, 0.14),
                new Vec3(sx * half, 0, sz * half),
                'hit',
            );
        }
        node.active = false;
        return node;
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
        title.label.string = '4v4 回合对战 DEMO';
        this.titleNode = title.node;

        const subtitle = this.labelNode(canvasNode, 'Subtitle', 16, {
            width: 900,
            height: 30,
            color: new Color(168, 178, 198, 255),
        });
        subtitle.label.string = '每回合每名角色依次选择攻击目标，直到一方全员倒下';
        this.subtitleNode = subtitle.node;

        const teamA = this.labelNode(canvasNode, 'Team A', 18, {
            width: 140,
            height: 24,
            bold: true,
            align: HorizontalTextAlignment.LEFT,
            anchorX: 0,
            color: new Color(120, 168, 235, 255),
        });
        teamA.label.string = '蓝方';
        this.teamLabelA = teamA.node;

        const teamB = this.labelNode(canvasNode, 'Team B', 18, {
            width: 140,
            height: 24,
            bold: true,
            align: HorizontalTextAlignment.RIGHT,
            anchorX: 1,
            color: new Color(235, 132, 126, 255),
        });
        teamB.label.string = '红方';
        this.teamLabelB = teamB.node;

        // 回合 / 行动提示
        const badge = new Node('Round Badge');
        badge.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(badge);
        const badgeTransform = badge.addComponent(UITransform);
        badgeTransform.setContentSize(340, 28);
        const badgeGraphics = badge.addComponent(Graphics);
        badgeGraphics.fillColor = new Color(10, 12, 20, 175);
        badgeGraphics.roundRect(-170, -14, 340, 28, 9);
        badgeGraphics.fill();
        badgeGraphics.lineWidth = 1.5;
        badgeGraphics.strokeColor = new Color(96, 110, 138, 130);
        badgeGraphics.roundRect(-170, -14, 340, 28, 9);
        badgeGraphics.stroke();
        const badgeLabel = this.labelNode(badge, 'Round Text', 15, {
            width: 320,
            height: 24,
            color: new Color(214, 222, 238, 255),
        });
        this.roundBadge = badge;
        this.roundLabel = badgeLabel.label;

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

        // 战斗结算浮层
        const overlay = new Node('Battle Result');
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

        for (const fighter of this.fighters) {
            this.huds.push(this.createHud(canvasNode, fighter));
        }

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
        label.lineHeight = Math.round(fontSize * 1.3);
        label.color = options.color ?? new Color(236, 241, 250, 255);
        label.horizontalAlign = options.align ?? HorizontalTextAlignment.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.enableWrapText = options.wrap ?? true;
        if (options.bold) {
            label.isBold = true;
        }
        return { node, label };
    }

    private createHud(canvas: Node, fighter: FighterRig): FighterHud {
        const mirror = fighter.side === 'B';
        const accent = PALETTES[fighter.side][fighter.slot].accent;

        const panel = new Node(`HUD ${fighter.name}`);
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
        backgroundGraphics.roundRect(-PANEL_WIDTH / 2, -PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT, 10);
        backgroundGraphics.fill();

        const borderNode = new Node('Panel Border');
        borderNode.layer = Layers.Enum.UI_2D;
        panel.addChild(borderNode);
        const borderTransform = borderNode.addComponent(UITransform);
        borderTransform.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
        const border = borderNode.addComponent(Graphics);

        const nameLabel = this.labelNode(panel, 'Name', 19, {
            width: 130,
            height: 26,
            bold: true,
            align: mirror ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.LEFT,
            anchorX: mirror ? 1 : 0,
            color: accent,
        });
        nameLabel.node.setPosition(mirror ? PANEL_WIDTH / 2 - 12 : -PANEL_WIDTH / 2 + 12, 17, 0);
        nameLabel.label.string = fighter.name;

        const hpLabel = this.labelNode(panel, 'HP', 13, {
            width: 110,
            height: 24,
            align: mirror ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.RIGHT,
            anchorX: mirror ? 0 : 1,
            color: new Color(198, 208, 226, 255),
        });
        hpLabel.node.setPosition(mirror ? -PANEL_WIDTH / 2 + 12 : PANEL_WIDTH / 2 - 12, 17, 0);
        hpLabel.label.string = `${MAX_HP} / ${MAX_HP}`;

        const barNode = new Node('HP Bar');
        barNode.layer = Layers.Enum.UI_2D;
        panel.addChild(barNode);
        barNode.setPosition(-PANEL_WIDTH / 2 + 12, -25, 0);
        const barTransform = barNode.addComponent(UITransform);
        barTransform.setContentSize(BAR_WIDTH, BAR_HEIGHT);
        const bar = barNode.addComponent(Graphics);

        this.paintBorder(border, BORDER_DEFAULT, 2);

        return { mirror, panel, bar, border, nameLabel: nameLabel.label, hpLabel: hpLabel.label, accent };
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
        this.teamLabelA?.setPosition(-halfWidth + 16, halfHeight - 92, 0);
        this.teamLabelB?.setPosition(halfWidth - 16, halfHeight - 92, 0);
        this.roundBadge?.setPosition(0, -halfHeight + 126, 0);
        this.logNode?.setPosition(0, -halfHeight + 82, 0);
        this.logBackdrop?.setPosition(0, -halfHeight + 82, 0);
        this.overlayNode?.setPosition(0, 40, 0);

        // 双方各 4 块 HUD，分别排成 2×2 贴在屏幕左右上角
        for (let slot = 0; slot < TEAM_SIZE; slot++) {
            const column = slot % 2;
            const row = Math.floor(slot / 2);
            const offsetX = 12 + PANEL_WIDTH / 2 + column * (PANEL_WIDTH + PANEL_GAP);
            const y = halfHeight - (HUD_TOP + PANEL_HEIGHT / 2 + row * (PANEL_HEIGHT + PANEL_GAP));
            this.huds[slot]?.panel.setPosition(-halfWidth + offsetX, y, 0);
            this.huds[slot + TEAM_SIZE]?.panel.setPosition(halfWidth - offsetX, y, 0);
        }
    }

    private updateHuds(): void {
        for (const fighter of this.fighters) {
            this.updateHud(fighter);
        }
    }

    private updateHud(fighter: FighterRig): void {
        const index = this.fighters.indexOf(fighter);
        const hud = this.huds[index];
        if (!hud) {
            return;
        }
        hud.hpLabel.string = `${fighter.hp} / ${MAX_HP}`;
        hud.nameLabel.color = fighter.alive ? hud.accent : DEAD_TEXT;
        this.drawHpBar(hud, fighter);
    }

    private drawHpBar(hud: FighterHud, fighter: FighterRig): void {
        const graphics = hud.bar;
        graphics.clear();

        graphics.fillColor = new Color(12, 16, 26, 210);
        graphics.roundRect(0, 0, BAR_WIDTH, BAR_HEIGHT, 4);
        graphics.fill();

        const ratio = Math.max(0, Math.min(1, fighter.hp / MAX_HP));
        const innerWidth = (BAR_WIDTH - 4) * ratio;
        if (innerWidth <= 1) {
            return;
        }
        if (!fighter.alive) {
            graphics.fillColor = BAR_EMPTY;
        } else if (ratio < 0.34) {
            graphics.fillColor = BAR_LOW;
        } else {
            graphics.fillColor = hud.accent;
        }
        const x = hud.mirror ? BAR_WIDTH - 2 - innerWidth : 2;
        graphics.roundRect(x, 2, innerWidth, BAR_HEIGHT - 4, 3);
        graphics.fill();
    }

    /** 重画某块 HUD 的描边 */
    private paintBorder(graphics: Graphics, color: Color, width: number): void {
        graphics.clear();
        graphics.lineWidth = width;
        graphics.strokeColor = color;
        graphics.roundRect(-PANEL_WIDTH / 2, -PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT, 10);
        graphics.stroke();
    }

    /**
     * 刷新 8 块 HUD 的描边：
     * 正在行动的unit用队伍色，被锁定的目标用金色，阵亡的unit用灰色。
     */
    private paintSelection(actor: FighterRig | null, target: FighterRig | null): void {
        for (let i = 0; i < this.fighters.length; i++) {
            const fighter = this.fighters[i];
            const hud = this.huds[i];
            if (!hud) {
                continue;
            }
            if (!fighter.alive) {
                this.paintBorder(hud.border, BORDER_DEAD, 1.5);
            } else if (target && fighter === target) {
                this.paintBorder(hud.border, BORDER_TARGET, 3.5);
            } else if (actor && fighter === actor) {
                this.paintBorder(hud.border, hud.accent, 3);
            } else {
                this.paintBorder(hud.border, BORDER_DEFAULT, 2);
            }
        }
    }

    private setLog(text: string): void {
        if (this.logLabel) {
            this.logLabel.string = text;
        }
    }

    private setRoundText(actorName?: string): void {
        if (!this.roundLabel) {
            return;
        }
        this.roundLabel.string = actorName
            ? `第 ${this.round} 回合 · ${actorName} 行动`
            : `第 ${this.round} 回合`;
    }

    /* -------------------------------------------------------------- */
    /* 战斗流程                                                        */
    /* -------------------------------------------------------------- */

    private async runBattle(): Promise<void> {
        while (this.isValid && this.ready) {
            // 兜底：如果上一场结算后没有重置成功，避免空跑
            const settled = this.checkWinner();
            if (settled) {
                await this.finishBout(settled);
                continue;
            }

            this.setRoundText();
            this.setLog(`第 ${this.round} 回合 — 依次选择攻击目标`);
            await this.delay(320);
            if (!this.isValid || !this.ready) {
                return;
            }

            let winner: Side | null = null;
            for (const index of this.turnOrder()) {
                if (!this.isValid || !this.ready) {
                    return;
                }
                const actor = this.fighters[index];
                if (!actor || !actor.alive) {
                    continue;
                }

                this.setRoundText(actor.name);
                const target = await this.chooseTarget(actor);
                if (!this.isValid || !this.ready) {
                    return;
                }
                if (!target) {
                    break;
                }

                await this.performAttack(actor, target);
                if (!this.isValid || !this.ready) {
                    return;
                }

                winner = this.checkWinner();
                if (winner) {
                    break;
                }
                await this.delay(260);
            }

            if (!this.isValid || !this.ready) {
                return;
            }
            if (winner) {
                await this.finishBout(winner);
                continue;
            }

            this.round += 1;
            this.setRoundText();
            await this.delay(420);
        }
    }

    /** 每回合的行动顺序：A1 → B1 → A2 → B2 → … */
    private turnOrder(): number[] {
        const order: number[] = [];
        for (let slot = 0; slot < TEAM_SIZE; slot++) {
            order.push(slot);
            order.push(TEAM_SIZE + slot);
        }
        return order;
    }

    /**
     * 目标选择阶段：先把所有存活敌人标成候选，再锁定其中一个。
     * 这里给 AI 留出一段可见的「思考」时间，让选择过程能看清楚。
     */
    private async chooseTarget(actor: FighterRig): Promise<FighterRig | null> {
        const enemies = this.fighters.filter((fighter) => fighter.alive && fighter.side !== actor.side);
        if (enemies.length === 0) {
            return null;
        }

        for (const fighter of this.fighters) {
            this.setRing(fighter, fighter.alive && enemies.indexOf(fighter) >= 0 ? 'candidate' : 'none');
        }
        this.paintSelection(actor, null);
        this.setLog(`${actor.name} 正在选择攻击目标…`);
        await this.delay(360);
        if (!this.isValid || !this.ready) {
            return null;
        }

        const target = this.pickTarget(actor, enemies);
        for (const fighter of this.fighters) {
            this.setRing(fighter, fighter === target ? 'target' : 'none');
        }
        this.paintSelection(actor, target);
        this.showReticle(target);
        this.setLog(`${actor.name} → ${target.name}｜HP ${target.hp}/${MAX_HP}`);
        await this.delay(480);
        return target;
    }

    /**
     * 自动选择目标：优先攻击残血（尽快让对手减员），
     * 血量相同时选择距离更近的敌人，再按站位顺序稳定排序。
     */
    private pickTarget(actor: FighterRig, enemies: FighterRig[]): FighterRig {
        let best = enemies[0];
        let bestScore = Number.POSITIVE_INFINITY;
        for (const enemy of enemies) {
            const distance = Math.abs(enemy.home.x - actor.home.x) + Math.abs(enemy.home.z - actor.home.z);
            const score = enemy.hp * 1000 + distance + enemy.slot * 0.01;
            if (score < bestScore) {
                bestScore = score;
                best = enemy;
            }
        }
        return best;
    }

    private async performAttack(actor: FighterRig, target: FighterRig): Promise<void> {
        Tween.stopAllByTarget(actor.root);
        Tween.stopAllByTarget(actor.hips);
        Tween.stopAllByTarget(actor.swordArm);

        const approach = new Vec3(
            target.root.position.x - actor.facing * APPROACH_GAP,
            0,
            target.root.position.z,
        );
        this.setLog(`${actor.name} 冲向 ${target.name}`);

        // 1. 走到对手面前
        this.startWalk(actor);
        await this.moveFighter(actor, approach, this.travelDuration(actor.root.position, approach), 'quadOut');
        this.stopWalk(actor);
        if (!this.isValid) {
            return;
        }

        // 2. 举剑蓄力
        await this.delay(80);
        await this.swingArm(actor, -actor.facing * 92, 0.2, 'quadOut');
        if (!this.isValid) {
            return;
        }

        // 3. 前冲挥剑
        await this.delay(60);
        const lunge = new Vec3(target.root.position.x - actor.facing * ATTACK_GAP, 0, target.root.position.z);
        const lungeMove = this.moveFighter(actor, lunge, this.travelDuration(actor.root.position, lunge, 0.12), 'quadIn');
        const swing = this.swingArm(actor, actor.facing * 64, 0.14, 'quadIn');
        await Promise.all([lungeMove, swing]);
        if (!this.isValid) {
            return;
        }

        // 4. 命中判定 + 打击特效
        this.spawnHitEffect(
            target.root.position.x - actor.facing * 0.32,
            1.24,
            target.root.position.z,
        );
        const gap = Math.abs(target.root.position.x - actor.root.position.x);
        if (gap <= 1.95) {
            this.damage(actor, target);
        } else {
            this.setLog(`${actor.name} 的攻击落空`);
        }

        // 5. 收剑、退回原位
        await this.delay(150);
        await this.swingArm(actor, 0, 0.22, 'quadInOut');
        if (!this.isValid) {
            return;
        }
        this.startWalk(actor);
        await this.moveFighter(actor, actor.home, this.travelDuration(actor.root.position, actor.home), 'quadInOut');
        this.stopWalk(actor);

        this.hideReticle();
        this.paintSelection(null, null);
    }

    private damage(actor: FighterRig, target: FighterRig): void {
        target.hp = Math.max(0, target.hp - 1);
        this.updateHud(target);
        this.reactDefender(target, actor.facing);
        this.shakeCamera(0.06);
        this.setRing(target, 'none');

        if (target.hp <= 0) {
            this.killFighter(target);
            this.setLog(`${actor.name} 击倒 ${target.name}！`);
            return;
        }
        this.setLog(`${actor.name} 命中 ${target.name}｜剩余 ${target.hp}/${MAX_HP}`);
    }

    private killFighter(fighter: FighterRig): void {
        fighter.alive = false;
        Tween.stopAllByTarget(fighter.root);
        Tween.stopAllByTarget(fighter.hips);
        Tween.stopAllByTarget(fighter.swordArm);
        for (const leg of fighter.legs) {
            Tween.stopAllByTarget(leg);
        }
        this.setRing(fighter, 'none');

        // 倒地
        tween(fighter.root)
            .to(0.5, {
                eulerAngles: new Vec3(0, 0, fighter.facing * 84),
                position: new Vec3(fighter.root.position.x, -0.12, fighter.root.position.z),
            }, { easing: 'quadIn' })
            .start();

        this.updateHud(fighter);
        const hud = this.huds[this.fighters.indexOf(fighter)];
        if (hud) {
            this.paintBorder(hud.border, BORDER_DEAD, 1.5);
        }
    }

    private checkWinner(): Side | null {
        const aAlive = this.fighters.some((fighter) => fighter.side === 'A' && fighter.alive);
        const bAlive = this.fighters.some((fighter) => fighter.side === 'B' && fighter.alive);
        if (aAlive && bAlive) {
            return null;
        }
        if (aAlive) {
            return 'A';
        }
        if (bAlive) {
            return 'B';
        }
        return null;
    }

    private async finishBout(winnerSide: Side): Promise<void> {
        const winnerName = SIDE_LABEL[winnerSide];
        this.setLog(`第 ${this.round} 回合结束 — ${winnerName}获胜！`);
        if (this.roundLabel) {
            this.roundLabel.string = `${winnerName}胜利`;
        }

        if (this.overlayNode && this.overlayLabel) {
            this.overlayLabel.string = `${winnerName}胜利！`;
            this.overlayNode.active = true;
            this.overlayNode.setScale(0.6, 0.6, 1);
            tween(this.overlayNode)
                .to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        }

        // 胜方存活角色一起举剑
        for (const fighter of this.fighters) {
            if (fighter.side !== winnerSide || !fighter.alive) {
                continue;
            }
            Tween.stopAllByTarget(fighter.swordArm);
            tween(fighter.swordArm)
                .to(0.32, { eulerAngles: new Vec3(0, 0, -fighter.facing * 150) }, { easing: 'backOut' })
                .start();
        }

        await this.delay(2600);
        if (!this.isValid) {
            return;
        }
        if (this.overlayNode) {
            this.overlayNode.active = false;
        }
        this.resetBout();
        // 留一点时间让「第 N 场开始」的提示能被看到
        await this.delay(600);
    }

    private resetBout(): void {
        this.battle += 1;
        this.round = 1;

        for (const fighter of this.fighters) {
            Tween.stopAllByTarget(fighter.root);
            Tween.stopAllByTarget(fighter.hips);
            Tween.stopAllByTarget(fighter.swordArm);
            for (const leg of fighter.legs) {
                Tween.stopAllByTarget(leg);
            }
            fighter.alive = true;
            fighter.hp = MAX_HP;
            fighter.root.setPosition(fighter.home);
            fighter.root.setRotationFromEuler(0, 0, 0);
            fighter.root.setScale(1, 1, 1);
            fighter.hips.setPosition(0, 0.84, 0);
            fighter.swordArm.setRotationFromEuler(0, 0, 0);
            for (const leg of fighter.legs) {
                leg.setRotationFromEuler(0, 0, 0);
            }
            this.setRing(fighter, 'none');
        }

        this.hideReticle();
        this.updateHuds();
        this.paintSelection(null, null);
        this.setRoundText();
        this.setLog(`第 ${this.battle} 场 — 第 1 回合，双方列阵`);
    }

    /* -------------------------------------------------------------- */
    /* 目标标记                                                        */
    /* -------------------------------------------------------------- */

    private setRing(fighter: FighterRig, state: RingState): void {
        const ring = fighter.ring;
        if (!ring || !ring.isValid) {
            return;
        }
        Tween.stopAllByTarget(ring);
        if (state === 'none') {
            ring.active = false;
            ring.setScale(1, 1, 1);
            return;
        }

        const materialKey = state === 'target' ? 'gold' : 'sky';
        for (const bar of ring.children) {
            const renderer = bar.getComponent(MeshRenderer);
            renderer?.setMaterial(this.material(materialKey), 0);
        }
        ring.active = true;
        ring.setScale(1, 1, 1);

        const peak = state === 'target' ? 1.18 : 1.06;
        const step = state === 'target' ? 0.42 : 0.62;
        tween(ring)
            .to(step, { scale: new Vec3(peak, 1, peak) }, { easing: 'sineInOut' })
            .to(step, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private showReticle(target: FighterRig): void {
        const reticle = this.reticle;
        if (!reticle || !reticle.isValid) {
            return;
        }
        this.reticleBase.set(target.root.position.x, 2.32, target.root.position.z);
        Tween.stopAllByTarget(reticle);
        reticle.setPosition(this.reticleBase);
        reticle.setScale(0.6, 0.6, 0.6);
        reticle.active = true;
        tween(reticle)
            .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    private hideReticle(): void {
        const reticle = this.reticle;
        if (!reticle || !reticle.isValid) {
            return;
        }
        Tween.stopAllByTarget(reticle);
        reticle.active = false;
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

    /** 走动时长按距离缩放，避免远距离的位移像瞬移 */
    private travelDuration(from: Vec3, to: Vec3, base = 0.35): number {
        const distance = Math.hypot(to.x - from.x, to.z - from.z);
        return Math.min(0.9, Math.max(0.35, base + distance * 0.075));
    }

    private moveFighter(fighter: FighterRig, target: Vec3, duration: number, easing: EasingName): Promise<void> {
        return new Promise<void>((resolve) => {
            tween(fighter.root)
                .to(duration, { position: new Vec3(target.x, target.y, target.z) }, { easing })
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
        const position = defender.root.position;
        Tween.stopAllByTarget(defender.root);
        tween(defender.root)
            .to(0.08, { position: new Vec3(position.x + facing * 0.2, position.y, position.z) }, { easing: 'quadOut' })
            .to(0.18, { position: new Vec3(position.x, position.y, position.z) }, { easing: 'quadInOut' })
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
    private spawnHitEffect(x: number, y: number, z: number): void {
        const world = this.world;
        if (!world || !world.isValid) {
            return;
        }

        const flash = this.box(world, 'Hit Flash', new Vec3(0.24, 0.24, 0.24), new Vec3(x, y, z), 'hit');
        tween(flash)
            .to(0.07, { scale: new Vec3(1.7, 1.7, 1.7) }, { easing: 'quadOut' })
            .to(0.13, { scale: new Vec3(0, 0, 0) }, { easing: 'quadIn' })
            .call(() => flash.destroy())
            .start();

        const streak = this.box(world, 'Hit Streak', new Vec3(0.9, 0.07, 0.07), new Vec3(x, y + 0.08, z), 'gold');
        tween(streak)
            .to(0.09, { scale: new Vec3(1.3, 1, 1) }, { easing: 'quadOut' })
            .to(0.12, { scale: new Vec3(0, 0, 0) }, { easing: 'quadIn' })
            .call(() => streak.destroy())
            .start();

        for (let i = 0; i < 7; i++) {
            const spark = this.box(world, `Spark ${i}`, new Vec3(0.11, 0.11, 0.11), new Vec3(x, y, z), i % 2 === 0 ? 'hit' : 'gold');
            const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
            const distance = 0.55 + Math.random() * 0.5;
            const target = new Vec3(
                x + Math.cos(angle) * distance,
                y + Math.sin(angle) * distance,
                z + (Math.random() - 0.5) * 0.4,
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
        ring.setPosition(x, 0.03, z);
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
