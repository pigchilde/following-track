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
  const [isContinuousMode, setIsContinuousMode] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [roundInterval, setRoundInterval] = useState('30');
  const [nextRoundCountdown, setNextRoundCountdown] = useState(0);
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

  const operationIdRef = useRef<string | null>(null);
  const shouldStopRef = useRef(false);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const baseOperationIdRef = useRef<string | null>(null);
  const statsRef = useRef<ProcessStats>({
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    changed: 0,
    skipped: 0,
  });

  useEffect(() => {
    const savedUsers = localStorage.getItem('newTwitterUsers');
    if (savedUsers) {
      setNewUsers(JSON.parse(savedUsers));
    }

    const savedFailedUsers = localStorage.getItem('failedTwitterUsers');
    if (savedFailedUsers) {
      setFailedUsers(JSON.parse(savedFailedUsers));
    }

    const savedTargetCount = localStorage.getItem('targetCount');
    if (savedTargetCount) {
      setTargetCount(savedTargetCount);
    }

    const savedRoundInterval = localStorage.getItem('roundInterval');
    if (savedRoundInterval) {
      setRoundInterval(savedRoundInterval);
    }

    const savedContinuousMode = localStorage.getItem('continuousMode');
    if (savedContinuousMode) {
      setIsContinuousMode(JSON.parse(savedContinuousMode));
    }

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (targetCount.trim()) {
      localStorage.setItem('targetCount', targetCount);
    }
  }, [targetCount]);

  useEffect(() => {
    if (roundInterval.trim()) {
      localStorage.setItem('roundInterval', roundInterval);
    }
  }, [roundInterval]);

  useEffect(() => {
    localStorage.setItem('continuousMode', JSON.stringify(isContinuousMode));
  }, [isContinuousMode]);

  const startCountdown = (seconds: number) => {
    setNextRoundCountdown(seconds);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    countdownTimerRef.current = setInterval(() => {
      setNextRoundCountdown(prev => {
        if (prev <= 1) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const stopCountdown = () => {
    setNextRoundCountdown(0);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };

  const generateOperationId = () => {
    const id = `operation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`生成新操作ID: ${id}`);
    return id;
  };

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

  const stopOperation = async () => {
    console.log(`停止操作，操作ID: ${operationIdRef.current}`);
    shouldStopRef.current = true;
    setIsPaused(false);
    setIsLoading(false);
    setIsRetrying(false);
    setIsContinuousMode(false);
    stopCountdown();

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
    baseOperationIdRef.current = null;
    setProgress('操作已停止');
    setCurrentUser(null);
    setCurrentRound(1);
  };

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

      if (operationIdRef.current !== operationId) {
        console.warn(`操作ID不匹配: 当前=${operationIdRef.current}, 请求=${operationId}`);
      }

      console.log(`获取 ${user.screenName} 的关注数...`);
      const currentFollowingCount = await getFollowingCountFromTwitter(user.screenName, operationId, reuseTab);
      console.log(`${user.screenName} 的关注数: ${currentFollowingCount} (类型: ${typeof currentFollowingCount})`);

      if (currentFollowingCount === -1) {
        const error = '无法获取关注数据';
        console.error(`用户 ${user.screenName} ${error}`);
        if (!isRetryMode) {
          saveFailedUser(user, error);
        }
        setStats(prev => ({ ...prev, processed: prev.processed + 1, failed: prev.failed + 1 }));
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
      console.log(`详细比较信息 - ${user.screenName}:`);
      console.log(`- currentFollowingCount: ${currentFollowingCount} (类型: ${typeof currentFollowingCount})`);
      console.log(`- user.followingCount: ${user.followingCount} (类型: ${typeof user.followingCount})`);

      const userFollowingCount =
        typeof user.followingCount === 'number' ? user.followingCount : parseInt(String(user.followingCount), 10);

      console.log(`- 转换后的userFollowingCount: ${userFollowingCount} (类型: ${typeof userFollowingCount})`);
      console.log(`- 严格相等比较 (===): ${currentFollowingCount === userFollowingCount}`);
      console.log(`- 不严格相等比较 (==): ${currentFollowingCount == userFollowingCount}`);
      console.log(`- 不等比较 (!=): ${currentFollowingCount != userFollowingCount}`);
      console.log(`- 严格不等比较 (!==): ${currentFollowingCount !== userFollowingCount}`);

      setStats(prev => ({ ...prev, processed: prev.processed + 1 }));
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

        try {
          console.log(`📞 正在调用 updateUser(${user.id}, ${currentFollowingCount}, ${newAdditions})...`);
          await updateUser(user.id, currentFollowingCount, newAdditions);
          console.log(`✅ 成功更新用户 ${user.screenName} 的数据库记录`);
        } catch (updateError) {
          console.error(`❌ 更新用户 ${user.screenName} 数据库记录失败:`, updateError);
        }

        const changeInfo = `${user.screenName} (ID: ${user.id}): ${userFollowingCount} → ${currentFollowingCount} (${newAdditions > 0 ? '+' : ''}${newAdditions})`;

        setStats(prev => ({ ...prev, successful: prev.successful + 1, changed: prev.changed + 1 }));
        statsRef.current = {
          ...statsRef.current,
          successful: statsRef.current.successful + 1,
          changed: statsRef.current.changed + 1,
        };

        console.log(`用户 ${user.screenName} 关注数从 ${userFollowingCount} 变为 ${currentFollowingCount}`);

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
        if (isRetryMode) {
          console.log(`重试成功(无变化)，从失败列表中移除用户 ${user.screenName}`);
          const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
          localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
          setFailedUsers(updatedFailedUsers);
        }
        setStats(prev => ({ ...prev, successful: prev.successful + 1, skipped: prev.skipped + 1 }));
        statsRef.current = {
          ...statsRef.current,
          successful: statsRef.current.successful + 1,
          skipped: statsRef.current.skipped + 1,
        };
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message === 'PAUSED') {
        console.log(`用户 ${user.screenName} 处理被暂停`);
        return null;
      }

      console.error(`处理用户 ${user.screenName} 时出错:`, error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';

      if (!isRetryMode) {
        saveFailedUser(user, errorMsg);
      }

      setStats(prev => ({ ...prev, processed: prev.processed + 1, failed: prev.failed + 1 }));
      statsRef.current = {
        ...statsRef.current,
        processed: statsRef.current.processed + 1,
        failed: statsRef.current.failed + 1,
      };
      setProgress(`处理 ${user.screenName} (ID: ${user.id}) 时出错: ${errorMsg}`);

      return null;
    }
  };

  const processUserGroup = async (
    users: TwitterUser[],
    operationId: string,
    shouldReuseTabForFirstUser: boolean = false,
  ): Promise<string[]> => {
    const newUsersInGroup: string[] = [];

    console.log(
      `processUserGroup: 操作ID=${operationId}, 用户数量=${users.length}, 第一个用户是否复用标签页=${shouldReuseTabForFirstUser}`,
    );

    for (let i = 0; i < users.length; i++) {
      if (shouldStopRef.current) break;

      const user = users[i];
      const isFirstUser = i === 0;
      // 如果是连续监听模式的新轮次，第一个用户也应该复用标签页
      const reuseTab = shouldReuseTabForFirstUser ? true : !isFirstUser;

      console.log(
        `处理用户 ${user.screenName} (${i + 1}/${users.length}): 是否第一个用户=${isFirstUser}, 是否复用标签页=${reuseTab}`,
      );

      const result = await processSingleUser(user, operationId, false, reuseTab);
      if (result) {
        newUsersInGroup.push(result);
      }

      if (i < users.length - 1 && !shouldStopRef.current) {
        const waitTime = Math.floor(Math.random() * (5 - 1 + 1) + 1) * 1000;
        console.log(`用户 ${user.screenName} 处理完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        setProgress(`用户 ${user.screenName} 处理完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    return newUsersInGroup;
  };

  const retryFailedUsers = async () => {
    if (failedUsers.length === 0) {
      setProgress('没有需要重试的用户');
      return [];
    }

    setIsRetrying(true);
    setProgress(`开始重试 ${failedUsers.length} 个失败的用户...`);

    const retryResults: string[] = [];

    let retryOperationId: string;
    if (isContinuousMode && baseOperationIdRef.current) {
      retryOperationId = `${baseOperationIdRef.current}-retry`;
    } else {
      retryOperationId = `${operationIdRef.current}-retry`;
    }

    console.log(
      `retryFailedUsers: 重试操作ID=${retryOperationId}, 连续监听模式=${isContinuousMode}, 失败用户数量=${failedUsers.length}`,
    );

    for (let i = 0; i < failedUsers.length; i++) {
      if (shouldStopRef.current) break;

      const failedUser = failedUsers[i];
      const isFirstUser = i === 0;
      // 在连续监听模式下，第一个重试用户也应该复用标签页
      const reuseTab = isContinuousMode ? true : !isFirstUser;

      console.log(
        `重试用户 ${failedUser.screenName} (${i + 1}/${failedUsers.length}): 是否第一个用户=${isFirstUser}, 是否复用标签页=${reuseTab}`,
      );

      // 构造用户对象
      const userForRetry: TwitterUser = {
        id: failedUser.id,
        screenName: failedUser.screenName,
        name: failedUser.name,
        followingCount: 0,
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

      if (i < failedUsers.length - 1 && !shouldStopRef.current) {
        const waitTime = Math.floor(Math.random() * (10 - 5 + 1) + 5) * 1000;
        console.log(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        setProgress(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    setIsRetrying(false);
    return retryResults;
  };

  const updateFollowingCounts = async (isNewRound: boolean = false) => {
    if (isLoading && !isNewRound) {
      console.log('已经有操作在进行中，请等待完成或停止当前操作');
      return;
    }

    const targetNumber = parseInt(targetCount.trim(), 10);
    if (!targetCount.trim() || isNaN(targetNumber) || targetNumber <= 0) {
      setProgress('❌ 请输入有效的处理条数（大于0的整数）');
      return;
    }

    if (isNewRound) {
      stopCountdown();
    }

    shouldStopRef.current = false;
    setIsLoading(true);
    setIsPaused(false);
    setIsRetrying(false);
    if (!isNewRound) {
      setCurrentRound(1);
    }

    const roundText = isContinuousMode ? `第 ${currentRound} 轮 - ` : '';
    setProgress(`${roundText}正在获取用户列表...`);
    setCurrentUser(null);
    setStats({ total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 });
    statsRef.current = { total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 };

    let newOperationId: string;
    if (isContinuousMode && baseOperationIdRef.current && isNewRound) {
      newOperationId = baseOperationIdRef.current;
      console.log(`连续监听模式第 ${currentRound} 轮，复用基础操作ID: ${newOperationId}`);
    } else {
      newOperationId = generateOperationId();
      if (isContinuousMode) {
        baseOperationIdRef.current = newOperationId;
        console.log(`连续监听模式首轮，生成并保存基础操作ID: ${newOperationId}`);
      }
    }
    operationIdRef.current = newOperationId;
    console.log(`开始新操作，操作ID: ${newOperationId}，目标处理条数: ${targetNumber}，轮次: ${currentRound}`);

    try {
      let processedFailedUsers = false;
      if (failedUsers.length > 0 && !shouldStopRef.current) {
        setProgress(`${roundText}优先重试 ${failedUsers.length} 个失败的用户...`);
        console.log(`优先重试 ${failedUsers.length} 个失败的用户...`);

        setStats(prev => ({ ...prev, total: failedUsers.length }));
        statsRef.current = { ...statsRef.current, total: failedUsers.length };

        const retryResults = await retryFailedUsers();
        console.log(`失败用户重试完成，发现 ${retryResults.length} 个用户关注数有变化`);

        if (retryResults.length > 0) {
          const existingUsers = JSON.parse(localStorage.getItem('newTwitterUsers') || '[]');
          const updatedUsers = [...retryResults, ...existingUsers];
          localStorage.setItem('newTwitterUsers', JSON.stringify(updatedUsers));
          setNewUsers(updatedUsers);
        }

        processedFailedUsers = true;
      }

      if (!shouldStopRef.current) {
        console.log('正在获取第一页数据...');
        const firstPageData = await fetchUsers(1, 10);
        console.log('第一页数据获取成功:', firstPageData);
        const apiTotal = firstPageData.data.pagination.total;

        const actualTotal = Math.min(targetNumber, apiTotal);
        const totalPages = Math.ceil(actualTotal / 10);

        const baseStats = processedFailedUsers
          ? statsRef.current
          : { total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 };
        setStats(prev => ({ ...prev, total: baseStats.total + actualTotal }));
        statsRef.current = { ...statsRef.current, total: baseStats.total + actualTotal };

        setProgress(
          `${roundText}目标处理 ${targetNumber} 个用户，API总共有 ${apiTotal} 个用户，实际处理 ${actualTotal} 个用户，分 ${totalPages} 组处理...`,
        );
        console.log(
          `目标处理 ${targetNumber} 个用户，API总共有 ${apiTotal} 个用户，实际处理 ${actualTotal} 个用户，分 ${totalPages} 组处理`,
        );

        const allNewUsers: string[] = [];

        const groupPromises: Promise<string[]>[] = [];
        const groupStats: { page: number; users: number }[] = [];
        let processedCount = 0;

        for (let page = 1; page <= totalPages && !shouldStopRef.current && processedCount < actualTotal; page++) {
          if (shouldStopRef.current) break;

          const processGroup = async (pageNum: number): Promise<string[]> => {
            setProgress(prev => `${prev}\n${roundText}正在处理第 ${pageNum}/${totalPages} 组...`);
            console.log(`开始处理第 ${pageNum}/${totalPages} 组...`);

            const pageData = pageNum === 1 ? firstPageData : await fetchUsers(pageNum, 10);
            let users = pageData.data.list;

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
              const groupOperationId = `${operationIdRef.current}-group-${pageNum}`;
              console.log(`第 ${pageNum} 组使用操作ID: ${groupOperationId}，基础操作ID: ${baseOperationIdRef.current}`);
              // 在连续监听模式的新轮次中，允许第一个用户复用标签页
              const shouldReuseTabForFirstUser = isContinuousMode && isNewRound;
              console.log(
                `第 ${pageNum} 组标签页复用判断: isContinuousMode=${isContinuousMode}, isNewRound=${isNewRound}, shouldReuseTabForFirstUser=${shouldReuseTabForFirstUser}`,
              );
              const newUsersInGroup = await processUserGroup(users, groupOperationId, shouldReuseTabForFirstUser);
              console.log(`第 ${pageNum} 组处理完成，发现 ${newUsersInGroup.length} 个用户关注数有变化`);
              return newUsersInGroup;
            }

            return [];
          };

          groupPromises.push(processGroup(page));

          if (page < totalPages && !shouldStopRef.current && processedCount < actualTotal) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        console.log(`等待 ${groupPromises.length} 个分组并行处理完成...`);
        setProgress(prev => `${prev}\n${roundText}等待 ${groupPromises.length} 个分组并行处理完成...`);

        const results = await Promise.all(groupPromises);

        results.forEach(groupResult => {
          allNewUsers.push(...groupResult);
        });

        console.log(`所有分组处理完成，分组情况: ${JSON.stringify(groupStats)}`);

        if (allNewUsers.length > 0) {
          console.log(`共发现 ${allNewUsers.length} 个用户关注数有变化，保存到本地存储`);
          const existingUsers = JSON.parse(localStorage.getItem('newTwitterUsers') || '[]');
          const updatedUsers = [...allNewUsers, ...existingUsers];
          localStorage.setItem('newTwitterUsers', JSON.stringify(updatedUsers));
          setNewUsers(updatedUsers);
        }
      }

      if (!shouldStopRef.current) {
        const finalFailedCount = JSON.parse(localStorage.getItem('failedTwitterUsers') || '[]').length;

        const finalStats = statsRef.current;
        const completionMessage = `✅ 第 ${currentRound} 轮处理完成！共处理 ${finalStats.processed} 个用户，成功 ${finalStats.successful}，失败 ${finalStats.failed}，无变化 ${finalStats.skipped}，发现 ${finalStats.changed} 个用户关注数有变化。${finalFailedCount > 0 ? `还有 ${finalFailedCount} 个用户处理失败。` : ''}`;
        setProgress(completionMessage);
        console.log(completionMessage);
        console.log('最终统计详情:', finalStats);

        if (isContinuousMode && !shouldStopRef.current) {
          const intervalSeconds = parseInt(roundInterval, 10);
          if (isNaN(intervalSeconds) || intervalSeconds <= 0) {
            setProgress(`${completionMessage}\n❌ 无效的轮次间隔时间，停止连续监听`);
            setIsContinuousMode(false);
          } else {
            setProgress(
              `${completionMessage}\n⏰ 连续监听模式已启用，${intervalSeconds} 秒后开始第 ${currentRound + 1} 轮`,
            );

            startCountdown(intervalSeconds);

            setTimeout(async () => {
              if (!shouldStopRef.current && isContinuousMode) {
                console.log(`⏰ 定时器触发，准备开始第 ${currentRound + 1} 轮`);
                setCurrentRound(prev => {
                  const newRound = prev + 1;
                  console.log(`🔄 轮次更新: ${prev} → ${newRound}`);
                  return newRound;
                });
                await updateFollowingCounts(true);
              }
            }, intervalSeconds * 1000);
          }
        }
      }
    } catch (error) {
      console.error('更新关注数时出错:', error);
      const errorMessage = `❌ 第 ${currentRound} 轮错误: ${error instanceof Error ? error.message : '未知错误'}`;
      setProgress(errorMessage);
      console.error(errorMessage);

      if (isContinuousMode && !shouldStopRef.current) {
        setProgress(prev => `${prev}\n⚠️ 将在 ${roundInterval} 秒后重试...`);
        const intervalSeconds = parseInt(roundInterval, 10);
        startCountdown(intervalSeconds);
        setTimeout(async () => {
          if (!shouldStopRef.current && isContinuousMode) {
            console.log(`⚠️ 错误重试定时器触发，重试第 ${currentRound} 轮`);
            await updateFollowingCounts(true);
          }
        }, intervalSeconds * 1000);
      }
    } finally {
      if (!isContinuousMode || shouldStopRef.current) {
        console.log(`操作结束，操作ID: ${operationIdRef.current}`);
        setIsLoading(false);
        setIsPaused(false);
        setIsRetrying(false);
        setCurrentUser(null);
        operationIdRef.current = null;
        if (shouldStopRef.current) {
          baseOperationIdRef.current = null;
          setCurrentRound(1);
        }
      } else {
        setCurrentUser(null);
        console.log(`第 ${currentRound} 轮完成，保持基础操作ID: ${baseOperationIdRef.current}`);
      }
    }
  };

  const clearNewUsers = () => {
    localStorage.removeItem('newTwitterUsers');
    setNewUsers([]);
  };

  const clearFailedUsers = () => {
    localStorage.removeItem('failedTwitterUsers');
    setFailedUsers([]);
  };

  return (
    <div className={cn('App', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <header className={cn('App-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <div className="mx-auto max-w-sm p-4">
          <h1 className="mb-4 text-center text-xl font-bold">Twitter 关注数更新工具</h1>

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

          {!isLoading && !isRetrying && (
            <div className="mb-4">
              <div className="mb-3">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={isContinuousMode}
                    onChange={e => setIsContinuousMode(e.target.checked)}
                    className="mr-2"
                  />
                  <span className={cn('text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    启用连续监听模式
                  </span>
                </label>
                <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                  启用后将自动循环监听，失败用户优先处理
                </p>
              </div>

              {isContinuousMode && (
                <div>
                  <label
                    htmlFor="roundInterval"
                    className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    轮次间隔 (秒):
                  </label>
                  <input
                    id="roundInterval"
                    type="number"
                    min="1"
                    max="60"
                    value={roundInterval}
                    onChange={e => setRoundInterval(e.target.value)}
                    placeholder="30"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                      isLight
                        ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                        : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                    )}
                  />
                  <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                    每轮处理完成后等待的时间，建议30-60秒
                  </p>
                </div>
              )}
            </div>
          )}

          {isContinuousMode && isLoading && (
            <div
              className={cn(
                'mb-4 rounded-lg border p-3 text-sm',
                isLight ? 'border-purple-200 bg-purple-50' : 'border-purple-700 bg-purple-900/30',
              )}>
              <div className="font-semibold">🔄 连续监听模式 - 第 {currentRound} 轮</div>
              {nextRoundCountdown > 0 && <div className="mt-1">⏰ 下一轮开始倒计时: {nextRoundCountdown}秒</div>}
            </div>
          )}

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
            <div className="flex gap-2">
              {!isLoading && !isRetrying ? (
                <button
                  onClick={() => updateFollowingCounts(false)}
                  disabled={
                    !targetCount.trim() ||
                    isNaN(parseInt(targetCount.trim(), 10)) ||
                    parseInt(targetCount.trim(), 10) <= 0 ||
                    (isContinuousMode &&
                      (!roundInterval.trim() ||
                        isNaN(parseInt(roundInterval.trim(), 10)) ||
                        parseInt(roundInterval.trim(), 10) <= 0 ||
                        parseInt(roundInterval.trim(), 10) > 60))
                  }
                  className={cn(
                    'flex-1 rounded-lg px-4 py-3 font-bold shadow-lg transition-all duration-200',
                    !targetCount.trim() ||
                      isNaN(parseInt(targetCount.trim(), 10)) ||
                      parseInt(targetCount.trim(), 10) <= 0 ||
                      (isContinuousMode &&
                        (!roundInterval.trim() ||
                          isNaN(parseInt(roundInterval.trim(), 10)) ||
                          parseInt(roundInterval.trim(), 10) <= 0 ||
                          parseInt(roundInterval.trim(), 10) > 60))
                      ? isLight
                        ? 'cursor-not-allowed bg-gray-300 text-gray-500'
                        : 'cursor-not-allowed bg-gray-600 text-gray-400'
                      : isLight
                        ? 'transform bg-blue-500 text-white hover:scale-105 hover:bg-blue-600 hover:shadow-xl'
                        : 'transform bg-blue-600 text-white hover:scale-105 hover:bg-blue-700 hover:shadow-xl',
                  )}>
                  {isContinuousMode ? '🔄 开始连续监听' : '🚀 开始更新关注数'}
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

            {(isLoading || isRetrying) && stats.total > 0 && (
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${(stats.processed / stats.total) * 100}%` }}></div>
              </div>
            )}

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
