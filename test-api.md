# 测试 API 服务

如果您还没有后端 API 服务，可以使用以下简单的 Node.js 服务来测试插件功能。

## 快速启动测试服务

创建一个 `test-server.js` 文件：

```javascript
const express = require('express');
const cors = require('cors');
const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 模拟的用户数据
const mockUsers = [
  {
    id: 1,
    createTime: "2025-01-01 12:00:00",
    updateTime: "2025-01-01 12:00:00",
    name: "Oraichain",
    screenName: "oraichain",
    profileImageUrl: "https://pbs.twimg.com/profile_images/1872173481657544704/SrZif3qM_normal.jpg",
    followersCount: "79.6k",
    createdAt: "4Y",
    classification: "聪明账号",
    followersChange: "+3",
    tenantId: null,
    friendsCount: "332",
    score: "559",
    smartFollowers: "132",
    followingCount: 100,
    newAdditions: 0
  },
  {
    id: 2,
    createTime: "2025-01-01 12:00:00",
    updateTime: "2025-01-01 12:00:00",
    name: "Ethereum",
    screenName: "ethereum",
    profileImageUrl: "https://pbs.twimg.com/profile_images/1872173481657544704/SrZif3qM_normal.jpg",
    followersCount: "3.2M",
    createdAt: "14Y",
    classification: "聪明账号",
    followersChange: "+5",
    tenantId: null,
    friendsCount: "256",
    score: "892",
    smartFollowers: "256",
    followingCount: 256,
    newAdditions: 0
  },
  {
    id: 3,
    createTime: "2025-01-01 12:00:00",
    updateTime: "2025-01-01 12:00:00",
    name: "Vitalik Buterin",
    screenName: "VitalikButerin",
    profileImageUrl: "https://pbs.twimg.com/profile_images/1872173481657544704/SrZif3qM_normal.jpg",
    followersCount: "5.1M",
    createdAt: "12Y",
    classification: "聪明账号",
    followersChange: "+8",
    tenantId: null,
    friendsCount: "1234",
    score: "999",
    smartFollowers: "567",
    followingCount: 1234,
    newAdditions: 0
  }
];

// 获取用户列表接口
app.post('/open/crawler/twitter_smart_user/page', (req, res) => {
  const { page = 1, size = 10 } = req.body;
  
  console.log('获取用户列表请求:', { page, size });
  
  const startIndex = (page - 1) * size;
  const endIndex = startIndex + size;
  const users = mockUsers.slice(startIndex, endIndex);
  
  res.json({
    code: 1000,
    message: "success",
    data: {
      list: users,
      pagination: {
        page: parseInt(page),
        size: parseInt(size),
        total: mockUsers.length
      }
    }
  });
});

// 更新用户数据接口
app.post('/open/crawler/twitter_smart_user/update', (req, res) => {
  const { id, followingCount, newAdditions } = req.body;
  
  console.log('更新用户数据请求:', { id, followingCount, newAdditions });
  
  // 查找用户并更新
  const userIndex = mockUsers.findIndex(user => user.id === id);
  if (userIndex !== -1) {
    mockUsers[userIndex].followingCount = followingCount;
    mockUsers[userIndex].newAdditions = newAdditions;
    mockUsers[userIndex].updateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    console.log('用户数据已更新:', mockUsers[userIndex]);
  }
  
  res.json({
    code: 1000,
    message: "success",
    data: {
      id,
      followingCount,
      newAdditions
    }
  });
});

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Test API server is running',
    timestamp: new Date().toISOString()
  });
});

const PORT = 8001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`测试 API 服务运行在 http://127.0.0.1:${PORT}`);
  console.log('可用的接口:');
  console.log('- POST /open/crawler/twitter_smart_user/page (获取用户列表)');
  console.log('- POST /open/crawler/twitter_smart_user/update (更新用户数据)');
  console.log('- GET /health (健康检查)');
});
```

## 安装依赖并启动

1. 安装依赖：
```bash
npm init -y
npm install express cors
```

2. 启动服务：
```bash
node test-server.js
```

## 测试接口

### 1. 健康检查
```bash
curl http://127.0.0.1:8001/health
```

### 2. 获取用户列表
```bash
curl -X POST http://127.0.0.1:8001/open/crawler/twitter_smart_user/page \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "size": 10}'
```

### 3. 更新用户数据
```bash
curl -X POST http://127.0.0.1:8001/open/crawler/twitter_smart_user/update \
  -H "Content-Type: application/json" \
  -d '{"id": 1, "followingCount": 105, "newAdditions": 5}'
```

## 使用 Docker（可选）

如果您想使用 Docker 运行测试服务，创建一个 `Dockerfile`：

```dockerfile
FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY test-server.js ./

EXPOSE 8001

CMD ["node", "test-server.js"]
```

然后运行：
```bash
docker build -t twitter-test-api .
docker run -p 8001:8001 twitter-test-api
```

## 注意事项

1. **CORS 配置**: 测试服务已配置 CORS 以允许浏览器访问
2. **数据持久性**: 测试服务使用内存存储，重启后数据会丢失
3. **真实用户**: 测试数据中的 screenName 是真实的 Twitter 用户，可以用来测试抓取功能
4. **端口冲突**: 如果 8001 端口被占用，请修改 PORT 变量 