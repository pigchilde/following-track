# CLAUDE.md

此文件为Claude Code (claude.ai/code)在此代码库中工作时提供指导。

## 项目概述

这是一个用于自动跟踪Twitter/X用户关注数的Chrome浏览器扩展程序。项目使用React + TypeScript，采用由pnpm和Turbo管理的monorepo结构。

## 开发命令

### 核心命令
- `pnpm install` - 安装所有包的依赖项
- `pnpm build` - 生产环境构建扩展
- `pnpm dev` - 启动开发模式，支持热重载
- `pnpm lint` - 在所有包中运行ESLint
- `pnpm lint:fix` - 自动修复代码规范问题
- `pnpm type-check` - 运行TypeScript类型检查

### 扩展特定命令
- `pnpm build:firefox` - 为Firefox浏览器构建
- `pnpm zip` - 创建可分发的ZIP文件
- `pnpm e2e` - 运行端到端测试

### 开发流程
- 使用`pnpm dev`进行活跃开发，支持热重载
- 源文件更改时扩展会自动重新构建
- 在Chrome开发者模式下加载`dist`文件夹作为未打包扩展

## 架构概览

### Monorepo结构
- **packages/**: 共享库和工具
  - `@extension/shared` - 通用工具和React hooks
  - `@extension/storage` - 数据持久化层
  - `@extension/ui` - 可复用UI组件
  - `@extension/i18n` - 国际化
- **pages/**: 扩展页面和脚本
  - `side-panel/` - 主要用户界面（侧边栏）
  - `popup/` - 扩展弹出界面
  - `content/` - 用于网页交互的内容脚本
  - `background/` - Service Worker/后台脚本
- **chrome-extension/**: 扩展清单和配置

### 核心组件

#### 后台脚本 (`chrome-extension/src/background/index.ts`)
- 处理Twitter页面导航和数据提取
- 管理标签页生命周期和错误恢复
- 实现代理切换以分散负载
- 处理错误页面恢复的站点数据清理
- 使用复杂的重试逻辑和多种提取策略

#### 侧边栏 (`pages/side-panel/src/SidePanel.tsx`)
- 控制扩展的主要用户界面
- 管理配置设置和操作状态
- 处理基于轮次的连续监控模式
- 支持代理配置管理
- 显示实时进度和统计信息

### 核心功能

#### Twitter关注数提取
- 使用多个CSS选择器和提取策略
- 处理不同页面状态（错误页面、私人账户）
- 实现数据验证以避免提取年份/日期
- 支持逗号分隔的数字和K/M/B后缀

#### 错误处理和恢复
- 检测需要清除缓存的特定Twitter错误页面
- 遇到错误时实现自动站点数据清理
- 在错误恢复过程中保存和恢复标签页
- 提供不同策略的多次重试尝试

#### 代理管理
- 支持基于处理数量的自动代理切换
- 从YAML文件或手动输入读取配置
- 默认每处理150个用户切换代理

## 测试

项目包含使用WebDriver的E2E测试：
- 测试文件位于`tests/e2e/specs/`
- 使用`pnpm e2e`运行测试
- 测试验证不同扩展页面的功能

## 配置说明

- 扩展需要API服务器运行（默认：可配置多个主机）
- 支持Chrome和Firefox构建
- 使用Turbo进行高效的monorepo构建
- 所有包使用一致的TypeScript配置
- 配置ESLint和Prettier确保代码质量

## 重要实现细节

- 扩展大量依赖内容脚本注入进行数据提取
- 后台Service Worker在标签页操作中维护状态
- 复杂的错误恢复系统以处理Twitter的动态特性
- 支持单次运行和连续监控模式
- 实现复杂的数据验证以避免误报