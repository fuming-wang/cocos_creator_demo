# 汽车之王

基于 **Cocos Creator 3.8.8** 的轻量 3D 超车小游戏 Demo。使用原生 3D 节点和材质构建，无需外部美术资源。

## 打开项目

使用 Cocos Dashboard 安装/选择 Creator 3.8.8，点击「添加项目」并选择本目录。

## 在编辑器中预览

1. 在 Creator 的资源管理器中打开 `assets/scenes/CarKing.scene`。
2. 点击编辑器顶部的「预览」按钮（▶），在浏览器预览页中点击一次画面，让键盘输入获得焦点。
3. 预览画面应显示 CAR KING 提示、道路和车辆。按 `A`/`D` 或方向键换道，`W`/`S` 调速。

场景里的 `Main Camera` 已经挂载了 `CarKingLauncher` 组件，不需要手动添加任何组件。游戏的道路、车辆、相机和 UI 都由 `CarKingGame` 在运行时创建，因此只要预览任意一个场景（包括 `Main.scene`）都会自动进入游戏。

## 实现要点

- `CarKingLauncher` 在场景启动时（`Director.EVENT_AFTER_SCENE_LAUNCH`）启动游戏，所以项目不依赖场景里手工挂载的组件；同时它也作为普通组件挂在 `Main Camera` 上，方便在编辑器中查看。
- `CarKingGame` 在运行场景下自建 `CarKing World` 根节点、3D 相机和 Canvas/UI 相机，不把世界节点挂到相机下面，避免相机移动/旋转时把道路一起带走。
- 3D 相机只渲染 `DEFAULT` 层，UI 使用单独的 `UI_2D` 正交相机，UI 文字不会被透视相机投影到屏幕外。
- 撞击后按 `空格`（或点击屏幕）原地重开，不再依赖 `director.loadScene(scene.name)`（场景节点的 `name` 为空，重开会失败）。

## 构建运行

在「项目 -> 构建发布」面板的场景列表勾选 `CarKing.scene`，并设为启动场景；构建 Web Desktop 后点击构建出的 `index.html` 对应本地服务预览。不要直接以文件协议打开 HTML。

## 操作

- `A` / `D` 或 `←` / `→`：左右变道
- `W` / `↑`：加速
- `S` / `↓`：减速
- `空格`：重新开始
- 移动端：点击屏幕左右侧变道，结束后点击屏幕重开

## Demo 内容

第三人称跟车相机、三车道道路及动态路标、随机交通车辆、碰撞结束、超车计分、速度显示和重开流程。
