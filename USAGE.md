# Twitter 关注数更新工具使用说明

## 功能概述

这是一个基于 React + TypeScript 的 Chrome 插件，用于自动更新 Twitter 用户的关注数信息。

## 主要功能

1. **侧边栏界面**：点击插件图标后，会在浏览器右侧打开侧边栏
2. **批量处理**：自动获取用户列表并分组处理
3. **数据抓取**：自动访问 Twitter 用户页面获取最新关注数
4. **数据对比**：对比新旧关注数，记录变化
5. **本地存储**：保存有变化的用户记录
6. **进度显示**：实时显示处理进度和状态

## 安装步骤

1. **构建插件**
   ```bash
   pnpm install
   pnpm build
   ```

2. **安装到 Chrome**
   - 打开 Chrome 浏览器
   - 访问 `chrome://extensions/`
   - 开启"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目的 `dist` 目录

## 使用说明

### 启动后端 API

在使用插件前，确保后端 API 服务运行在 `http://127.0.0.1:8001`

### 使用插件

1. **打开侧边栏**
   - 点击 Chrome 工具栏中的插件图标
   - 侧边栏会在浏览器右侧打开

2. **更新关注数**
   - 点击"更新关注数"按钮
   - 插件会自动：
     - 从 API 获取用户列表
     - 分组处理用户（每组 10 个）
     - 为每个用户打开 Twitter 页面
     - 获取最新关注数
     - 对比并更新数据
     - 显示处理进度

3. **查看结果**
   - 处理完成后，会显示有变化的用户列表
   - 新增关注显示为 `+数量`
   - 减少关注显示为 `-数量`
   - 点击"清除记录"可清空本地存储

## API 接口

### 获取用户列表
- **URL**: `POST http://127.0.0.1:8001/open/crawler/twitter_smart_user/page`
- **参数**: 
  ```json
  {
    "page": 1,
    "size": 10
  }
  ```

### 更新用户数据
- **URL**: `POST http://127.0.0.1:8001/open/crawler/twitter_smart_user/update`
- **参数**:
  ```json
  {
    "id": 1,
    "followingCount": 100,
    "newAdditions": 1
  }
  ```

## 技术特性

### 架构设计
- **React + TypeScript**: 现代化前端框架
- **Chrome Extension Manifest V3**: 最新插件标准
- **消息传递**: Side Panel 与 Background Script 通信
- **多选择器策略**: 适应 Twitter 页面结构变化

### 数据处理
- **批量处理**: 分组处理避免过载
- **错误处理**: 单个用户失败不影响整体流程
- **延迟控制**: 避免请求过于频繁
- **本地存储**: 保存处理结果

### 用户体验
- **实时进度**: 显示当前处理状态
- **主题切换**: 支持明暗主题
- **响应式设计**: 适配不同屏幕尺寸
- **错误反馈**: 详细的错误信息显示

## 注意事项

1. **网络环境**: 需要能够访问 Twitter 和本地 API
2. **权限要求**: 插件需要访问所有网站的权限
3. **处理时间**: 大量用户的处理可能需要较长时间
4. **Twitter 限制**: 过于频繁的访问可能被 Twitter 限制

## 故障排除

### 常见问题

1. **API 连接失败**
   - 检查后端服务是否运行
   - 确认 API 地址正确

2. **无法获取关注数**
   - 检查 Twitter 页面结构是否变化
   - 确认网络连接正常

3. **插件无法加载**
   - 检查 Chrome 扩展开发者模式是否开启
   - 确认 dist 目录构建成功

4. **侧边栏不显示**
   - 刷新页面后重试
   - 检查浏览器控制台是否有错误

## 开发说明

### 项目结构
```
├── chrome-extension/          # 插件核心配置
├── pages/
│   ├── side-panel/           # 侧边栏页面
│   ├── popup/                # 弹出页面（已禁用）
│   └── content/              # 内容脚本
├── packages/                 # 共享组件和工具
└── dist/                     # 构建输出目录
```

### 开发命令
```bash
pnpm dev        # 开发模式
pnpm build      # 生产构建
pnpm lint       # 代码检查
pnpm test       # 运行测试
``` 