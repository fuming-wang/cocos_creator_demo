import { _decorator, Component, Director, director, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { CarKingGame } from './CarKingGame';

const { ccclass } = _decorator;

/**
 * Starts the demo inside the scene that is currently running.
 *
 * Returns the existing game component when one is already present, so calling this
 * from both the component and the scene-launch hook cannot create two games.
 */
export function startCarKingInScene(scene: Node | null, host?: Node | null): CarKingGame | null {
    if (!scene || !scene.isValid) {
        console.error('[CarKingLauncher] no running scene, the game cannot start');
        return null;
    }
    const existing = scene.getComponentInChildren(CarKingGame);
    if (existing) {
        return existing;
    }
    const target = host && host.isValid ? host : (() => {
        const node = new Node('CarKing Game');
        node.layer = scene.layer;
        node.setParent(scene);
        return node;
    })();
    return target.addComponent(CarKingGame);
}

/**
 * Optional component. Attach it to any node of a scene to run the demo from there;
 * the game builds its own world, camera and UI, so the host node does not matter.
 */
@ccclass('CarKingLauncher')
export class CarKingLauncher extends Component {
    public onLoad(): void {
        startCarKingInScene(director.getScene(), this.node);
    }
}

/**
 * Project entry point.
 *
 * A scene can only run scripts that are referenced by a component or by the bundle
 * entry, so depending on a hand-placed component means the project shows an empty
 * scene when that component is missing (which is exactly how this demo used to
 * behave). Registering the launch hook here makes every scene start the game as
 * soon as it is launched by preview or by a build.
 */
if (!EDITOR) {
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
        startCarKingInScene(director.getScene());
    });
}
