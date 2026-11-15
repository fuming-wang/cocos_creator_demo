import { _decorator, Component, Director, director, Node, Scene } from 'cc';
import { EDITOR } from 'cc/env';
import { DuelGame } from './DuelGame';

const { ccclass } = _decorator;

/**
 * 确保目前场景中有且只有一个 DuelGame。
 * 场景中没有手动挂载时，也能在场景载入后自动把游戏跑起来。
 */
export function startDuelInScene(scene: Scene | null, host?: Node): DuelGame | null {
    if (!scene || !scene.isValid) {
        return null;
    }
    const existing = scene.getComponentInChildren(DuelGame);
    if (existing) {
        return existing;
    }
    if (host && host.isValid) {
        return host.addComponent(DuelGame);
    }
    const node = new Node('Duel Game');
    node.layer = scene.layer;
    scene.addChild(node);
    return node.addComponent(DuelGame);
}

@ccclass('DuelLauncher')
export class DuelLauncher extends Component {
    protected onLoad(): void {
        startDuelInScene(this.node.scene, this.node);
    }
}

if (!EDITOR) {
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
        startDuelInScene(director.getScene());
    });
}
