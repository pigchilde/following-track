import '@src/SidePanel.css';
import { t } from '@extension/i18n';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui';
import { useState, useEffect, useRef } from 'react';

// 定义 API 响应的类型
interface TwitterUser {
  createTime: string;
  updateTime: string;
  name: string;
  screenName: string;
  profileImageUrl: string;
  followersCount: string;
  createdAt: string;
  classification: string;
  followersChange: string;
  tenantId: null;
  friendsCount: string;
  score: string;
  smartFollowers: string;
  id: number;
  followingCount: number;
  newAdditions: number;
}

interface ApiResponse {
  code: number;
  message: string;
  data: {
    list: TwitterUser[];
    pagination: {
      page: number;
      size: number;
      total: number;
    };
  };
}

interface ProcessStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  changed: number;
  skipped: number;
}

interface FailedUser {
  id: number;
  screenName: string;
  name: string;
  error: string;
  timestamp: string;
}

const SidePanel = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [progress, setProgress] = useState('');
  const [currentUser, setCurrentUser] = useState<{ screenName: string; id: number; name: string } | null>(null);
  const [newUsers, setNewUsers] = useState<string[]>([]);
  const [failedUsers, setFailedUsers] = useState<FailedUser[]>([]);
  const [targetCount, setTargetCount] = useState<string>('');
  const [stats, setStats] = useState<ProcessStats>({
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    changed: 0,
    skipped: 0,
  });
  const [cycleCount, setCycleCount] = useState(0);

  const operationIdRef = useRef<string | null>(null);
  const shouldStopRef = useRef(false);
  // 添加一个ref来实时追踪统计数据，避免React状态更新延迟导致的显示问题
  const statsRef = useRef<ProcessStats>({
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    changed: 0,
    skipped: 0,
  });

  // 从本地存储加载之前的数据
  useEffect(() => {
    const savedUsers = localStorage.getItem('newTwitterUsers');
    if (savedUsers) {
      setNewUsers(JSON.parse(savedUsers));
    }

    const savedFailedUsers = localStorage.getItem('failedTwitterUsers');
    if (savedFailedUsers) {
      setFailedUsers(JSON.parse(savedFailedUsers));
    }

    // 加载保存的目标条数
    const savedTargetCount = localStorage.getItem('targetCount');
    if (savedTargetCount) {
      setTargetCount(savedTargetCount);
    }
  }, []);

  // 保存目标条数到本地存储
  useEffect(() => {
    if (targetCount.trim()) {
      localStorage.setItem('targetCount', targetCount);
    }
  }, [targetCount]);

  // 生成唯一的操作ID
  const generateOperationId = () => {
    const id = `operation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`生成新操作ID: ${id}`);
    return id;
  };

  // 获取用户数据
  const fetchUsers = async (page: number = 1, size: number = 10): Promise<ApiResponse> => {
    const response = await fetch('http://127.0.0.1:7072/open/crawler/twitter_smart_user/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page, size }),
    });

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }

    return await response.json();
  };

  // 更新用户数据
  const updateUser = async (id: number, followingCount: number, newAdditions: number) => {
    console.log('updateUser', id, followingCount, newAdditions);
    const response = await fetch('http://127.0.0.1:7072/open/crawler/twitter_smart_user/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, followingCount, newAdditions }),
    });

    if (!response.ok) {
      throw new Error(`更新失败: ${response.status}`);
    }

    return await response.json();
  };

  // 向 background script 发送消息获取 Twitter 关注数
  const getFollowingCountFromTwitter = async (
    screenName: string,
    operationId: string,
    reuseTab: boolean = false,
  ): Promise<number> => {
    console.log(`请求获取 ${screenName} 的关注数，操作ID: ${operationId}，重用标签页: ${reuseTab}`);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'getFollowingCount',
          screenName: screenName,
          operationId: operationId,
          reuseTab: reuseTab,
        },
        response => {
          console.log(`收到 ${screenName} 的关注数响应:`, response);
          console.log(`响应类型: ${typeof response}, 响应详情:`, JSON.stringify(response, null, 2));

          if (chrome.runtime.lastError) {
            console.error(`获取 ${screenName} 关注数时出错:`, chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            console.log(`成功获取 ${screenName} 的关注数: ${response.count} (类型: ${typeof response.count})`);
            // 确保返回的是数字类型
            const count = typeof response.count === 'number' ? response.count : parseInt(response.count, 10);
            if (isNaN(count)) {
              console.error(`关注数不是有效数字: ${response.count}`);
              reject(new Error('返回的关注数不是有效数字'));
            } else {
              console.log(`✅ 解析后的关注数: ${count} (类型: ${typeof count})，即将返回给调用者`);
              resolve(count);
            }
          } else if (response && response.paused) {
            console.log(`获取 ${screenName} 的关注数被暂停`);
            reject(new Error('PAUSED'));
          } else {
            console.error(`获取 ${screenName} 关注数失败:`, response?.error || '未知错误');
            console.error(`完整响应对象:`, response);
            reject(new Error(response?.error || '无法获取关注数'));
          }
        },
      );
    });
  };

  // 保存失败的用户到本地存储
  const saveFailedUser = (user: TwitterUser, error: string) => {
    const failedUser: FailedUser = {
      id: user.id,
      screenName: user.screenName,
      name: user.name,
      error: error,
      timestamp: new Date().toISOString(),
    };

    const existingFailedUsers = JSON.parse(localStorage.getItem('failedTwitterUsers') || '[]');
    const updatedFailedUsers = [failedUser, ...existingFailedUsers.filter((u: FailedUser) => u.id !== user.id)];
    localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
    setFailedUsers(updatedFailedUsers);
  };

  // 暂停操作
  const pauseOperation = async () => {
    if (!operationIdRef.current) {
      console.log('没有正在进行的操作，无法暂停');
      return;
    }

    console.log(`暂停操作，操作ID: ${operationIdRef.current}`);
    setIsPaused(true);
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: 'pauseOperation',
            operationId: operationIdRef.current,
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error('暂停失败'));
            }
          },
        );
      });
      setProgress('操作已暂停');
    } catch (error) {
      console.error('暂停操作失败:', error);
    }
  };

  // 恢复操作
  const resumeOperation = async () => {
    if (!operationIdRef.current) {
      console.log('没有已暂停的操作，无法恢复');
      return;
    }

    console.log(`恢复操作，操作ID: ${operationIdRef.current}`);
    setIsPaused(false);
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: 'resumeOperation',
            operationId: operationIdRef.current,
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error('恢复失败'));
            }
          },
        );
      });
      setProgress('操作已恢复');
    } catch (error) {
      console.error('恢复操作失败:', error);
    }
  };

  // 停止操作
  const stopOperation = async () => {
    console.log(`停止操作，操作ID: ${operationIdRef.current}`);
    shouldStopRef.current = true;
    setIsPaused(false);
    setIsLoading(false);
    setIsRetrying(false);

    if (operationIdRef.current) {
      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              action: 'stopOperation',
              operationId: operationIdRef.current,
            },
            response => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response && response.success) {
                resolve(response);
              } else {
                reject(new Error('停止失败'));
              }
            },
          );
        });
      } catch (error) {
        console.error('停止操作失败:', error);
      }
    }

    operationIdRef.current = null;
    setProgress('操作已停止');
    setCurrentUser(null);
  };

  // 处理单个用户
  const processSingleUser = async (
    user: TwitterUser,
    operationId: string,
    isRetryMode: boolean = false,
    reuseTab: boolean = false,
  ): Promise<string | null> => {
    console.log(
      `开始处理用户 ${user.screenName}，操作ID: ${operationId}，重试模式: ${isRetryMode}，重用标签页: ${reuseTab}`,
    );

    if (shouldStopRef.current) {
      console.log(`用户 ${user.screenName} 处理被停止`);
      return null;
    }

    // 检查是否暂停
    while (isPaused && !shouldStopRef.current) {
      console.log(`用户 ${user.screenName} 处理被暂停，等待恢复...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (shouldStopRef.current) {
      console.log(`用户 ${user.screenName} 处理被停止(暂停后)`);
      return null;
    }

    try {
      setCurrentUser({ screenName: user.screenName, id: user.id, name: user.name });
      const modeText = isRetryMode ? '(重试)' : '';
      setProgress(`正在处理用户 ${user.screenName} (ID: ${user.id}) - ${user.name} ${modeText}`);

      // 确保操作ID与当前操作ID一致
      if (operationIdRef.current !== operationId) {
        console.warn(`操作ID不匹配: 当前=${operationIdRef.current}, 请求=${operationId}`);
        // 继续使用传入的操作ID
      }

      console.log(`获取 ${user.screenName} 的关注数...`);
      const currentFollowingCount = await getFollowingCountFromTwitter(user.screenName, operationId, reuseTab);
      console.log(`${user.screenName} 的关注数: ${currentFollowingCount} (类型: ${typeof currentFollowingCount})`);

      if (currentFollowingCount === -1) {
        // 无法获取关注数，记录为失败
        const error = '无法获取关注数据';
        console.error(`用户 ${user.screenName} ${error}`);
        if (!isRetryMode) {
          saveFailedUser(user, error);
        }
        setStats(prev => ({ ...prev, processed: prev.processed + 1, failed: prev.failed + 1 }));
        // 同时更新ref
        statsRef.current = {
          ...statsRef.current,
          processed: statsRef.current.processed + 1,
          failed: statsRef.current.failed + 1,
        };
        setProgress(`用户 ${user.screenName} (ID: ${user.id}) 处理失败: ${error}`);
        return null;
      }

      console.log(
        `用户 ${user.screenName} 关注数获取成功: ${currentFollowingCount}, 数据库中的关注数: ${user.followingCount}`,
      );
      // 添加详细的数据类型和值比较调试信息
      console.log(`详细比较信息 - ${user.screenName}:`);
      console.log(`- currentFollowingCount: ${currentFollowingCount} (类型: ${typeof currentFollowingCount})`);
      console.log(`- user.followingCount: ${user.followingCount} (类型: ${typeof user.followingCount})`);

      // 确保user.followingCount是数字类型，因为API可能返回字符串
      const userFollowingCount =
        typeof user.followingCount === 'number' ? user.followingCount : parseInt(String(user.followingCount), 10);

      console.log(`- 转换后的userFollowingCount: ${userFollowingCount} (类型: ${typeof userFollowingCount})`);
      console.log(`- 严格相等比较 (===): ${currentFollowingCount === userFollowingCount}`);
      console.log(`- 不严格相等比较 (==): ${currentFollowingCount == userFollowingCount}`);
      console.log(`- 不等比较 (!=): ${currentFollowingCount != userFollowingCount}`);
      console.log(`- 严格不等比较 (!==): ${currentFollowingCount !== userFollowingCount}`);

      setStats(prev => ({ ...prev, processed: prev.processed + 1 }));
      // 同时更新ref
      statsRef.current = {
        ...statsRef.current,
        processed: statsRef.current.processed + 1,
      };

      if (currentFollowingCount !== userFollowingCount) {
        console.log(`🔄 检测到关注数变化，准备调用 updateUser 函数...`);
        const newAdditions = currentFollowingCount - userFollowingCount;
        console.log(
          `用户 ${user.screenName} 关注数变化: ${userFollowingCount} → ${currentFollowingCount} (${newAdditions > 0 ? '+' : ''}${newAdditions})`,
        );

        // 更新数据库
        try {
          console.log(`📞 正在调用 updateUser(${user.id}, ${currentFollowingCount}, ${newAdditions})...`);
          await updateUser(user.id, currentFollowingCount, newAdditions);
          console.log(`✅ 成功更新用户 ${user.screenName} 的数据库记录`);
        } catch (updateError) {
          console.error(`❌ 更新用户 ${user.screenName} 数据库记录失败:`, updateError);
          // 即使数据库更新失败，我们仍然记录变化
        }

        // 记录有变化的用户
        const changeInfo = `${user.screenName} (ID: ${user.id}): ${userFollowingCount} → ${currentFollowingCount} (${newAdditions > 0 ? '+' : ''}${newAdditions})`;

        setStats(prev => ({ ...prev, successful: prev.successful + 1, changed: prev.changed + 1 }));
        // 同时更新ref
        statsRef.current = {
          ...statsRef.current,
          successful: statsRef.current.successful + 1,
          changed: statsRef.current.changed + 1,
        };

        console.log(`用户 ${user.screenName} 关注数从 ${userFollowingCount} 变为 ${currentFollowingCount}`);

        // 如果是重试模式成功了，从失败列表中移除
        if (isRetryMode) {
          console.log(`重试成功，从失败列表中移除用户 ${user.screenName}`);
          const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
          localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
          setFailedUsers(updatedFailedUsers);
        }

        return changeInfo;
      } else {
        console.log(`❌ 关注数无变化，跳过更新数据库 - ${user.screenName}`);
        console.log(
          `- 原因：currentFollowingCount (${currentFollowingCount}) === userFollowingCount (${userFollowingCount})`,
        );
        console.log(`用户 ${user.screenName} 关注数无变化: ${userFollowingCount}`);
        // 如果是重试模式且数据没变化，也算成功，从失败列表中移除
        if (isRetryMode) {
          console.log(`重试成功(无变化)，从失败列表中移除用户 ${user.screenName}`);
          const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
          localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
          setFailedUsers(updatedFailedUsers);
        }
        setStats(prev => ({ ...prev, successful: prev.successful + 1, skipped: prev.skipped + 1 }));
        // 同时更新ref
        statsRef.current = {
          ...statsRef.current,
          successful: statsRef.current.successful + 1,
          skipped: statsRef.current.skipped + 1,
        };
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message === 'PAUSED') {
        // 如果是暂停，不计入失败
        console.log(`用户 ${user.screenName} 处理被暂停`);
        return null;
      }

      console.error(`处理用户 ${user.screenName} 时出错:`, error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';

      if (!isRetryMode) {
        saveFailedUser(user, errorMsg);
      }

      setStats(prev => ({ ...prev, processed: prev.processed + 1, failed: prev.failed + 1 }));
      // 同时更新ref
      statsRef.current = {
        ...statsRef.current,
        processed: statsRef.current.processed + 1,
        failed: statsRef.current.failed + 1,
      };
      setProgress(`处理 ${user.screenName} (ID: ${user.id}) 时出错: ${errorMsg}`);

      return null;
    }
  };

  // 处理用户组
  const processUserGroup = async (users: TwitterUser[], operationId: string): Promise<string[]> => {
    const newUsersInGroup: string[] = [];

    // 第一个用户不重用标签页，后续用户重用同一标签页
    for (let i = 0; i < users.length; i++) {
      if (shouldStopRef.current) break;

      const user = users[i];
      const isFirstUser = i === 0;
      const reuseTab = !isFirstUser; // 第一个用户不重用，后续用户重用

      // 使用分组特定的操作ID，确保每个分组使用独立的标签页
      const result = await processSingleUser(user, operationId, false, reuseTab);
      if (result) {
        newUsersInGroup.push(result);
      }

      // 如果不是最后一个用户且没有停止，则等待随机时间
      if (i < users.length - 1 && !shouldStopRef.current) {
        // 生成20-30秒的随机等待时间
        // const waitTime = Math.floor(Math.random() * (10 - 5 + 1) + 5) * 1000;
        const waitTime = Math.floor(Math.random() * (20 - 10 + 1) + 10) * 1000;
        console.log(`用户 ${user.screenName} 处理完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        setProgress(`用户 ${user.screenName} 处理完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    return newUsersInGroup;
  };

  // 重试失败的用户
  const retryFailedUsers = async () => {
    if (failedUsers.length === 0) {
      setProgress('没有需要重试的用户');
      return [];
    }

    setIsRetrying(true);
    setProgress(`开始重试 ${failedUsers.length} 个失败的用户...`);

    const retryResults: string[] = [];

    // 为重试创建一个特定的操作ID
    const retryOperationId = `${operationIdRef.current}-retry`;

    // 失败用户也使用同一个标签页处理
    for (let i = 0; i < failedUsers.length; i++) {
      if (shouldStopRef.current) break;

      const failedUser = failedUsers[i];
      const isFirstUser = i === 0;
      const reuseTab = !isFirstUser; // 第一个用户不重用，后续用户重用

      // 构造用户对象
      const userForRetry: TwitterUser = {
        id: failedUser.id,
        screenName: failedUser.screenName,
        name: failedUser.name,
        followingCount: 0, // 默认值，实际会被重新获取
        createTime: '',
        updateTime: '',
        profileImageUrl: '',
        followersCount: '',
        createdAt: '',
        classification: '',
        followersChange: '',
        tenantId: null,
        friendsCount: '',
        score: '',
        smartFollowers: '',
        newAdditions: 0,
      };

      const result = await processSingleUser(userForRetry, retryOperationId, true, reuseTab);
      if (result) {
        retryResults.push(result);
      }

      // 如果不是最后一个用户且没有停止，则等待随机时间
      if (i < failedUsers.length - 1 && !shouldStopRef.current) {
        // 生成5-10秒的随机等待时间
        const waitTime = Math.floor(Math.random() * (10 - 5 + 1) + 5) * 1000;
        console.log(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        setProgress(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    setIsRetrying(false);
    return retryResults;
  };

  // 主要的更新关注数功能
  const updateFollowingCounts = async () => {
    if (isLoading) {
      console.log('已经有操作在进行中，请等待完成或停止当前操作');
      return;
    }

    // 验证输入的目标条数
    const targetNumber = parseInt(targetCount.trim(), 10);
    if (!targetCount.trim() || isNaN(targetNumber) || targetNumber <= 0) {
      setProgress('❌ 请输入有效的处理条数（大于0的整数）');
      return;
    }

    // 重置状态
    shouldStopRef.current = false;
    setIsLoading(true);
    // setIsPaused(false); // Paused state should persist unless explicitly changed
    // setIsRetrying(false); // Will be reset per cycle if needed
    // setProgress('正在获取用户列表...'); // Will be set per cycle
    // setCurrentUser(null); // Will be reset per cycle
    // Stats will be reset per cycle

    // 生成新的操作ID - This should happen *before* the loop
    const newOperationId = generateOperationId();
    operationIdRef.current = newOperationId;
    console.log(`开始新操作，操作ID: ${newOperationId}，目标处理条数: ${targetNumber}`);
    setCycleCount(0); // Initialize cycle count

    // Initialize stats before the loop for the first display
    setStats({ total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 });
    statsRef.current = { total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 };

    while (!shouldStopRef.current) {
      let currentCycleNumber = 0;
      setCycleCount(prevCount => {
        currentCycleNumber = prevCount + 1;
        return currentCycleNumber;
      });
      // Allow state to update, though direct use of currentCycleNumber is safer for immediate messages
      await new Promise(resolve => setTimeout(resolve, 0));


      try {
        setProgress(`Cycle ${currentCycleNumber}: 开始获取用户数据...`);
        // 首先获取第一页数据以了解总数
        console.log(`Cycle ${currentCycleNumber}: 正在获取第一页数据...`);
        const firstPageData = await fetchUsers(1, 10);
        console.log(`Cycle ${currentCycleNumber}: 第一页数据获取成功:`, firstPageData);
        const apiTotal = firstPageData.data.pagination.total;

        // 使用用户指定的条数和API返回的总数中的较小值
        const actualTotal = Math.min(targetNumber, apiTotal);
        const totalPages = Math.ceil(actualTotal / 10);

        setStats(prev => ({ ...prev, total: actualTotal }));
        // 同时更新ref
        statsRef.current = { ...statsRef.current, total: actualTotal };
        setProgress(
          `Cycle ${currentCycleNumber}: 目标 ${targetNumber}, API 总数 ${apiTotal}, 本轮实际处理 ${actualTotal}, 分 ${totalPages} 组...`,
        );
        console.log(
          `Cycle ${currentCycleNumber}: 目标处理 ${targetNumber} 个用户，API总共有 ${apiTotal} 个用户，实际处理 ${actualTotal} 个用户，分 ${totalPages} 组处理`,
        );

        const allNewUsers: string[] = [];

        // 准备所有分组的数据
        const groupPromises: Promise<string[]>[] = [];
        const groupStats: { page: number; users: number }[] = [];
        let processedCount = 0; // 追踪已处理的用户数

        // 并行处理所有分组
        for (let page = 1; page <= totalPages && !shouldStopRef.current && processedCount < actualTotal; page++) {
          if (shouldStopRef.current) break;

          // 创建一个异步函数来处理每个分组
          const processGroup = async (pageNum: number): Promise<string[]> => {
            setProgress(prev => `Cycle ${currentCycleNumber}: ${prev}\n正在处理第 ${pageNum}/${totalPages} 组...`);
            console.log(`Cycle ${currentCycleNumber}: 开始处理第 ${pageNum}/${totalPages} 组...`);

            // 获取当前分组的数据
            const pageData = pageNum === 1 ? firstPageData : await fetchUsers(pageNum, 10);
            let users = pageData.data.list;

            // 如果这是最后一组，可能需要限制用户数量
            const remainingCount = actualTotal - processedCount;
            if (users.length > remainingCount) {
              users = users.slice(0, remainingCount);
            }

            console.log(
              `第 ${pageNum} 组有 ${users.length} 个用户（原始 ${pageData.data.list.length} 个，限制后 ${users.length} 个）`,
            );
            groupStats.push({ page: pageNum, users: users.length });
            processedCount += users.length;

            if (users.length > 0) {
              console.log(`开始处理第 ${pageNum} 组的 ${users.length} 个用户...`);
              // 为每个分组创建一个唯一的操作ID，以便区分不同分组的操作
              const groupOperationId = `${operationIdRef.current}-group-${pageNum}`;
              const newUsersInGroup = await processUserGroup(users, groupOperationId);
              console.log(`第 ${pageNum} 组处理完成，发现 ${newUsersInGroup.length} 个用户关注数有变化`);
              return newUsersInGroup;
            }

            return [];
          };

          // 将每个分组的处理添加到Promise数组中
          groupPromises.push(processGroup(page));

          // 短暂延迟启动下一个分组，避免同时打开太多标签页
          if (page < totalPages && !shouldStopRef.current && processedCount < actualTotal) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        // 等待所有分组处理完成
        console.log(`等待 ${groupPromises.length} 个分组并行处理完成...`);
        setProgress(prev => `${prev}\n等待 ${groupPromises.length} 个分组并行处理完成...`);

        const results = await Promise.all(groupPromises);

        // 合并所有分组的结果
        results.forEach(groupResult => {
          allNewUsers.push(...groupResult);
        });

        console.log(`所有分组处理完成，分组情况: ${JSON.stringify(groupStats)}`);

        if (!shouldStopRef.current) {
          // 尝试重试失败的用户
          if (failedUsers.length > 0) {
            setProgress(`Cycle ${currentCycleNumber}: 重试 ${failedUsers.length} 个失败用户...`);
            console.log(`Cycle ${currentCycleNumber}: 正在重试 ${failedUsers.length} 个失败的用户...`);
            const retryResults = await retryFailedUsers(); // retryFailedUsers might need currentCycleNumber for its own setProgress calls
            console.log(`Cycle ${currentCycleNumber}: 重试完成，变化 ${retryResults.length} 个`);
            allNewUsers.push(...retryResults);
          }

          // 保存到本地存储
          if (allNewUsers.length > 0) {
            console.log(`共发现 ${allNewUsers.length} 个用户关注数有变化，保存到本地存储`);
            const existingUsers = JSON.parse(localStorage.getItem('newTwitterUsers') || '[]');
            const updatedUsers = [...allNewUsers, ...existingUsers]; // 新的放在前面
            localStorage.setItem('newTwitterUsers', JSON.stringify(updatedUsers));
            setNewUsers(updatedUsers);
          }

          const finalFailedCount = JSON.parse(localStorage.getItem('failedTwitterUsers') || '[]').length;

          // 使用ref中的准确统计数据，避免React状态更新延迟
          const finalStats = statsRef.current;
          const completionMessage = `✅ Cycle ${currentCycleNumber}: 处理完成！共处理 ${finalStats.processed} 个用户，成功 ${finalStats.successful}，失败 ${finalStats.failed}，无变化 ${finalStats.skipped}，发现 ${allNewUsers.length} 个用户关注数有变化。${finalFailedCount > 0 ? `还有 ${finalFailedCount} 个用户处理失败。` : ''}`;
          setProgress(completionMessage);
          console.log(completionMessage);
          console.log(`Cycle ${currentCycleNumber}: 最终统计详情:`, finalStats);
        }
      } catch (error) {
        console.error(`Cycle ${currentCycleNumber}: 更新关注数时出错:`, error);
        const errorMessage = `❌ Cycle ${currentCycleNumber} 错误: ${error instanceof Error ? error.message : '未知错误'}`;
        setProgress(errorMessage);
        console.error(errorMessage);
      } finally {
        console.log(`Cycle ${currentCycleNumber}: 操作结束，操作ID: ${operationIdRef.current}`);
        setCurrentUser(null);
      }
      // Inter-cycle delay, pause check, and state resets
      if (!shouldStopRef.current) {
        const completedCycleNo = currentCycleNumber; // Capture for messages
        // Honor pause state: if a cycle completes while paused, wait until resumed.
        while (isPaused && !shouldStopRef.current) {
          setProgress(`Cycle ${completedCycleNo} 完成。操作已暂停。等待恢复才能开始下一周期...`);
          console.log(`Cycle ${completedCycleNo} 完成。操作已暂停。等待恢复才能开始下一周期...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (shouldStopRef.current) {
          console.log('操作在周期切换时停止。');
        } else {
          const nextCycleNo = completedCycleNo + 1;
          setProgress(`Cycle ${completedCycleNo} 处理完毕。等待 5 秒后开始 Cycle ${nextCycleNo}...`);
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Reset per-cycle states for the next iteration (these are already done at start of loop by now)
          console.log(`准备开始 Cycle ${nextCycleNo}：重置状态...`);
          setNewUsers([]);
          setFailedUsers([]);
          setCurrentUser(null);
          setIsRetrying(false);

          setStats({ total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 });
          statsRef.current = { total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 };
          // cycleCount is incremented at the start of the while loop.
          // setProgress(`Cycle ${nextCycleNo}: 新周期即将开始...`); // This will be set at the start of the next iteration.
        }
      }
    } // End of while (!shouldStopRef.current)

    // Cleanup that happens only when the entire operation is stopped or completed
    console.log(`总操作已结束或外部停止，操作ID: ${operationIdRef.current}`);
    setIsLoading(false);
    setIsPaused(false); // Reset pause state on final stop
    setIsRetrying(false);
    // setCurrentUser(null); // This is now reset per-cycle or by stopOperation
    if (operationIdRef.current) {
        operationIdRef.current = null;
    }
    // Set final progress message
    if (shouldStopRef.current && progress !== '操作已停止') {
        // If force stopped and stopOperation's message hasn't taken precedence
        setProgress('操作已停止。');
    } else if (!shouldStopRef.current) {
        // If loop completed all its intended cycles (e.g. if there was a max cycle count)
        setProgress('所有周期处理完成。');
    } // Otherwise, keep the message from stopOperation or the last cycle message if loop broke early
  };

  // 清除本地存储的新用户记录
  const clearNewUsers = () => {
    localStorage.removeItem('newTwitterUsers');
    setNewUsers([]);
  };

  // 清除失败用户记录
  const clearFailedUsers = () => {
    localStorage.removeItem('failedTwitterUsers');
    setFailedUsers([]);
  };

  return (
    <div className={cn('App', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <header className={cn('App-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <div className="mx-auto max-w-sm p-4">
          <h1 className="mb-4 text-center text-xl font-bold">Twitter 关注数更新工具</h1>

          {/* 处理条数输入框 */}
          {!isLoading && !isRetrying && (
            <div className="mb-4">
              <label
                htmlFor="targetCount"
                className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                处理条数:
              </label>
              <input
                id="targetCount"
                type="number"
                min="1"
                value={targetCount}
                onChange={e => setTargetCount(e.target.value)}
                placeholder="请输入要处理的用户数量"
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                  isLight
                    ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                    : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                )}
              />
              <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                输入一个大于0的整数，如果超过API总数则以API总数为准
              </p>
            </div>
          )}

          {/* 统计信息 */}
          {(isLoading || isRetrying) && (
            <div
              className={cn(
                'mb-4 rounded-lg border p-3 text-sm',
                isLight ? 'border-blue-200 bg-blue-50' : 'border-blue-700 bg-blue-900/30',
              )}>
              <div className="grid grid-cols-2 gap-2">
                <div>总数: {stats.total}</div>
                <div>已处理: {stats.processed}</div>
                <div>成功: {stats.successful}</div>
                <div>失败: {stats.failed}</div>
                <div>无变化: {stats.skipped}</div>
                <div>有变化: {stats.changed}</div>
                <div>进度: {stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0}%</div>
                <div>{isRetrying ? '重试模式' : '正常模式'}</div>
              </div>
            </div>
          )}

          {/* 失败用户统计 */}
          {failedUsers.length > 0 && !isLoading && !isRetrying && (
            <div
              className={cn(
                'mb-4 rounded-lg border p-3 text-sm',
                isLight ? 'border-orange-200 bg-orange-50' : 'border-orange-700 bg-orange-900/30',
              )}>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">⚠️ 处理失败的用户: {failedUsers.length}</span>
                <button
                  onClick={clearFailedUsers}
                  className={cn(
                    'rounded px-2 py-1 text-xs transition-colors hover:bg-opacity-80',
                    isLight
                      ? 'bg-orange-200 text-orange-800 hover:bg-orange-300'
                      : 'bg-orange-800 text-orange-200 hover:bg-orange-700',
                  )}>
                  🗑️ 清除
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto">
                <ul className="space-y-1 text-xs">
                  {failedUsers.slice(0, 5).map((user, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2">•</span>
                      <span className="break-all">
                        {user.screenName} (ID: {user.id}): {user.error}
                      </span>
                    </li>
                  ))}
                  {failedUsers.length > 5 && <li className="text-gray-500">...还有 {failedUsers.length - 5} 个</li>}
                </ul>
              </div>
            </div>
          )}

          {/* 当前处理用户信息 */}
          {currentUser && (
            <div
              className={cn(
                'mb-4 rounded-lg border p-3 text-sm',
                isLight ? 'border-yellow-200 bg-yellow-50' : 'border-yellow-700 bg-yellow-900/30',
              )}>
              <div className="font-semibold">当前处理用户:</div>
              <div>用户名: @{currentUser.screenName}</div>
              <div>ID: {currentUser.id}</div>
              <div>昵称: {currentUser.name}</div>
            </div>
          )}

          <div className="space-y-4">
            {/* 控制按钮 */}
            <div className="flex gap-2">
              {!isLoading && !isRetrying ? (
                <button
                  onClick={updateFollowingCounts}
                  disabled={
                    !targetCount.trim() ||
                    isNaN(parseInt(targetCount.trim(), 10)) ||
                    parseInt(targetCount.trim(), 10) <= 0
                  }
                  className={cn(
                    'flex-1 rounded-lg px-4 py-3 font-bold shadow-lg transition-all duration-200',
                    !targetCount.trim() ||
                      isNaN(parseInt(targetCount.trim(), 10)) ||
                      parseInt(targetCount.trim(), 10) <= 0
                      ? isLight
                        ? 'cursor-not-allowed bg-gray-300 text-gray-500'
                        : 'cursor-not-allowed bg-gray-600 text-gray-400'
                      : isLight
                        ? 'transform bg-blue-500 text-white hover:scale-105 hover:bg-blue-600 hover:shadow-xl'
                        : 'transform bg-blue-600 text-white hover:scale-105 hover:bg-blue-700 hover:shadow-xl',
                  )}>
                  🚀 开始更新关注数
                </button>
              ) : (
                <>
                  {!isPaused ? (
                    <button
                      onClick={pauseOperation}
                      className={cn(
                        'flex-1 rounded-lg px-4 py-3 font-bold shadow-lg transition-all duration-200',
                        isLight
                          ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                          : 'bg-yellow-600 text-white hover:bg-yellow-700',
                      )}>
                      ⏸️ 暂停
                    </button>
                  ) : (
                    <button
                      onClick={resumeOperation}
                      className={cn(
                        'flex-1 rounded-lg px-4 py-3 font-bold shadow-lg transition-all duration-200',
                        isLight
                          ? 'bg-green-500 text-white hover:bg-green-600'
                          : 'bg-green-600 text-white hover:bg-green-700',
                      )}>
                      ▶️ 恢复
                    </button>
                  )}
                  <button
                    onClick={stopOperation}
                    className={cn(
                      'rounded-lg px-4 py-3 font-bold shadow-lg transition-all duration-200',
                      isLight ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-red-600 text-white hover:bg-red-700',
                    )}>
                    ⏹️ 停止
                  </button>
                </>
              )}
            </div>

            {/* 进度条 */}
            {(isLoading || isRetrying) && stats.total > 0 && (
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${(stats.processed / stats.total) * 100}%` }}></div>
              </div>
            )}

            {/* 状态信息 */}
            {progress && (
              <div
                className={cn(
                  'rounded-lg border-l-4 p-3 text-sm',
                  isLoading || isRetrying
                    ? isPaused
                      ? isLight
                        ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                        : 'border-yellow-400 bg-yellow-900/30 text-yellow-200'
                      : isLight
                        ? 'border-blue-400 bg-blue-50 text-blue-800'
                        : 'border-blue-400 bg-blue-900/30 text-blue-200'
                    : progress.includes('✅')
                      ? isLight
                        ? 'border-green-400 bg-green-50 text-green-800'
                        : 'border-green-400 bg-green-900/30 text-green-200'
                      : progress.includes('❌')
                        ? isLight
                          ? 'border-red-400 bg-red-50 text-red-800'
                          : 'border-red-400 bg-red-900/30 text-red-200'
                        : isLight
                          ? 'border-gray-400 bg-gray-50 text-gray-800'
                          : 'border-gray-400 bg-gray-900/30 text-gray-200',
                )}>
                {progress}
              </div>
            )}

            {/* 结果显示 */}
            {newUsers.length > 0 && (
              <div
                className={cn(
                  'rounded-lg border p-4',
                  isLight
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-green-700 bg-green-900/30 text-green-200',
                )}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">关注数有变化的用户 ({newUsers.length}):</h3>
                  <button
                    onClick={clearNewUsers}
                    className={cn(
                      'rounded px-2 py-1 text-xs transition-colors hover:bg-opacity-80',
                      isLight
                        ? 'bg-green-200 text-green-800 hover:bg-green-300'
                        : 'bg-green-800 text-green-200 hover:bg-green-700',
                    )}>
                    🗑️ 清除记录
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <ul className="space-y-2 text-xs">
                    {newUsers.map((user, index) => (
                      <li key={index} className="flex items-start rounded bg-black/10 p-2">
                        <span className="mr-2 text-green-600">📈</span>
                        <span className="break-all font-mono">{user}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-gray-300 pt-4">
            <ToggleButton onClick={exampleThemeStorage.toggle}>{t('toggleTheme')}</ToggleButton>
          </div>
        </div>
      </header>
    </div>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
