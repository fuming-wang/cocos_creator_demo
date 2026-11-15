# three-king · 回合对战 DEMO

一个用 **Cocos Creator 3.8.8** 做的极简回合制对战演示。场景里没有预制的美术资源，
角色、场地和 UI 全部在运行时由代码用方块拼出来，所以拉下项目打开就能跑。

## 玩法

- 左侧蓝色小人 **A**，右侧红色小人 **B**，各自站在原位。
- **A** 向右走到 B 面前挥剑攻击一次，然后退回原位。
- 接着 **B** 向左走到 A 面前挥剑攻击一次，然后退回原位。
- 以上流程反复循环；任意一方生命值归零时弹出胜负提示，随后自动开始下一回合。

每人 5 点生命值，每命中一次扣 1 点。当前回合、命中与胜负都会显示在画面底部的战斗日志里。

![对战画面](docs/preview-hit.png)

## 项目结构

```
assets/
  scenes/Duel.scene        场景（只放相机、灯光和启动器组件）
  scripts/DuelGame.ts      游戏主体：场地、角色、UI、战斗流程、命中特效
  scripts/DuelLauncher.ts  启动器：保证场景加载后 DuelGame 一定存在
settings/                  项目设置
profiles/                  编辑器设置（预览起始场景已指向 Duel.scene）
```

`DuelGame` 在 `onLoad` 里先确保 `builtin-standard`（PBR）效果可用，再搭建
世界、相机、灯光、场地、两个角色和 Canvas UI，最后启动一条用 `await` 串起来的
回合流程。移动、挥剑、受击后退和胜负结算都用 `tween` 完成，命中判定在挥剑到位
后按两人距离检查。

## 运行方式

1. 用 Cocos Creator 3.8.8 打开本文件夹（`Duel.scene` 已设为预览起始场景）。
2. 点编辑器上方的 **预览** 按钮，或打开 `Duel.scene` 后预览。

需要命令行构建时：

```bash
CocosCreator.exe --project D:\code\three-king --build "platform=web-desktop;debug=true"
```

构建产物在 `build/web-desktop`，用本地静态服务器打开 `index.html` 即可。

## 备注

- 角色、场地和 UI 都是代码生成的，`Duel.scene` 只保留相机、灯光和启动器，方便对照调整。
- `DuelLauncher` 通过 `director.on(Director.EVENT_AFTER_SCENE_LAUNCH)` 挂载游戏，
  所以场景里不用手动拖组件，换成任意带相机的场景也能跑起来。
