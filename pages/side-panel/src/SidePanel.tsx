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
  const [roundInterval, setRoundInterval] = useState('10');
  const [changeThreshold, setChangeThreshold] = useState('50');
  const [nextRoundCountdown, setNextRoundCountdown] = useState(0);
  const [progress, setProgress] = useState('');
  const [currentUser, setCurrentUser] = useState<{ screenName: string; id: number; name: string } | null>(null);
  const [newUsers, setNewUsers] = useState<string[]>([]);
  const [failedUsers, setFailedUsers] = useState<FailedUser[]>([]);
  const [targetCount, setTargetCount] = useState<string>('');
  const [apiServerHost, setApiServerHost] = useState<string>('43.143.87.115:7072');
  const [randomDelayMin, setRandomDelayMin] = useState<string>('10');
  const [randomDelayMax, setRandomDelayMax] = useState<string>('20');
  const [stats, setStats] = useState<ProcessStats>({
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    changed: 0,
    skipped: 0,
  });

  // 新增：代理配置相关状态
  const [proxyUrl, setProxyUrl] = useState<string>('http://127.0.0.1:9090/proxies/辣条');
  const [proxyConfig, setProxyConfig] = useState<string>('[{"name": "日本-联通中转"},{"name": "美国-联通中转"}]');
  const [currentProxy, setCurrentProxy] = useState<string>('');

  // 新增：配置折叠状态
  const [isConfigCollapsed, setIsConfigCollapsed] = useState<boolean>(true);

  // 新增：代理切换通知状态
  const [proxyChangeStatus, setProxyChangeStatus] = useState<{
    show: boolean;
    timestamp: string;
    proxyName: string;
    reason: string;
  } | null>(null);

  // 重试模式的独立统计数据
  const [retryStats, setRetryStats] = useState<ProcessStats>({
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    changed: 0,
    skipped: 0,
  });

  // 添加清除站点数据的状态
  const [clearSiteDataStatus, setClearSiteDataStatus] = useState<{
    show: boolean;
    timestamp: string;
    screenName: string;
    reason: string;
  } | null>(null);

  // 添加当前操作ID状态
  const [currentOperationId, setCurrentOperationId] = useState<string | null>(null);

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

  // 重试模式统计数据的引用
  const retryStatsRef = useRef<ProcessStats>({
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

    const savedChangeThreshold = localStorage.getItem('changeThreshold');
    if (savedChangeThreshold) {
      setChangeThreshold(savedChangeThreshold);
    }

    const savedContinuousMode = localStorage.getItem('continuousMode');
    if (savedContinuousMode) {
      setIsContinuousMode(JSON.parse(savedContinuousMode));
    }

    const savedApiServerHost = localStorage.getItem('apiServerHost');
    if (savedApiServerHost) {
      setApiServerHost(savedApiServerHost);
    }

    const savedRandomDelayMin = localStorage.getItem('randomDelayMin');
    if (savedRandomDelayMin) {
      setRandomDelayMin(savedRandomDelayMin);
    }

    const savedRandomDelayMax = localStorage.getItem('randomDelayMax');
    if (savedRandomDelayMax) {
      setRandomDelayMax(savedRandomDelayMax);
    }

    // 新增：加载代理配置
    const savedProxyUrl = localStorage.getItem('proxyUrl');
    if (savedProxyUrl) {
      setProxyUrl(savedProxyUrl);
    }

    const savedProxyConfig = localStorage.getItem('proxyConfig');
    if (savedProxyConfig) {
      setProxyConfig(savedProxyConfig);
    }

    const savedCurrentProxy = localStorage.getItem('currentProxy');
    if (savedCurrentProxy) {
      setCurrentProxy(savedCurrentProxy);
    }

    // 新增：加载配置折叠状态
    const savedConfigCollapsed = localStorage.getItem('configCollapsed');
    if (savedConfigCollapsed) {
      setIsConfigCollapsed(JSON.parse(savedConfigCollapsed));
    }

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  // 监听来自background的消息
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.action === 'siteDataCleared') {
        console.log('收到站点数据清除通知:', message);
        setClearSiteDataStatus({
          show: true,
          timestamp: message.timestamp,
          screenName: message.screenName,
          reason: message.reason,
        });

        // 5秒后自动隐藏
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 5000);
      } else if (message.action === 'errorRecoverySuccess') {
        console.log('收到错误恢复成功通知:', message);
        setClearSiteDataStatus({
          show: true,
          timestamp: message.timestamp,
          screenName: message.screenName,
          reason: `错误页面恢复成功 (尝试${message.attempts}次，following数: ${message.followingCount})`,
        });

        // 8秒后自动隐藏（成功消息显示更久）
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 8000);
      } else if (message.action === 'errorRecoveryFailed') {
        console.log('收到错误恢复失败通知:', message);

        const reasonText = message.forceCleanedUp
          ? `错误页面恢复失败 (尝试${message.attempts}次，已强制清理所有标签页)`
          : `错误页面恢复失败 (尝试${message.attempts}次)`;

        setClearSiteDataStatus({
          show: true,
          timestamp: message.timestamp,
          screenName: message.screenName,
          reason: reasonText,
        });

        // 10秒后自动隐藏（失败消息显示更久）
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 10000);
      } else if (message.action === 'errorHandlingFailed') {
        console.log('收到错误处理失败通知:', message);
        setClearSiteDataStatus({
          show: true,
          timestamp: message.timestamp,
          screenName: message.screenName,
          reason: `错误处理失败${message.source ? ` (${message.source})` : ''}: ${message.error}`,
        });

        // 10秒后自动隐藏
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 10000);
      } else if (message.action === 'proxyChanged') {
        console.log('收到代理切换通知:', message);
        setProxyChangeStatus({
          show: true,
          timestamp: message.timestamp,
          proxyName: message.proxyName,
          reason: `已切换到代理: ${message.proxyName} (原因: ${message.reason || '手动切换'})`,
        });

        // 更新当前代理状态
        setCurrentProxy(message.proxyName);

        // 5秒后自动隐藏
        setTimeout(() => {
          setProxyChangeStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 5000);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
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
    if (changeThreshold.trim()) {
      localStorage.setItem('changeThreshold', changeThreshold);
    }
  }, [changeThreshold]);

  useEffect(() => {
    localStorage.setItem('continuousMode', JSON.stringify(isContinuousMode));
  }, [isContinuousMode]);

  useEffect(() => {
    if (apiServerHost.trim()) {
      localStorage.setItem('apiServerHost', apiServerHost);
    }
  }, [apiServerHost]);

  useEffect(() => {
    if (randomDelayMin.trim()) {
      localStorage.setItem('randomDelayMin', randomDelayMin);
    }
  }, [randomDelayMin]);

  useEffect(() => {
    if (randomDelayMax.trim()) {
      localStorage.setItem('randomDelayMax', randomDelayMax);
    }
  }, [randomDelayMax]);

  // 新增：保存代理配置
  useEffect(() => {
    if (proxyUrl.trim()) {
      localStorage.setItem('proxyUrl', proxyUrl);
    }
  }, [proxyUrl]);

  useEffect(() => {
    if (proxyConfig.trim()) {
      localStorage.setItem('proxyConfig', proxyConfig);
    }
  }, [proxyConfig]);

  useEffect(() => {
    if (currentProxy.trim()) {
      localStorage.setItem('currentProxy', currentProxy);
    }
  }, [currentProxy]);

  // 新增：保存配置折叠状态
  useEffect(() => {
    localStorage.setItem('configCollapsed', JSON.stringify(isConfigCollapsed));
  }, [isConfigCollapsed]);

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
    setCurrentOperationId(id);
    return id;
  };

  // 新增：手动切换代理函数
  const switchProxyManually = async () => {
    try {
      console.log('🔄 手动切换代理...');
      setProgress('🔄 正在切换代理...');

      // 调用background脚本进行代理切换
      const response = await chrome.runtime.sendMessage({
        action: 'switchProxy',
      });

      if (response.success) {
        console.log('✅ 手动代理切换成功:', response);
        setProgress('✅ 代理切换成功');

        // 显示成功消息
        setTimeout(() => {
          setProgress('');
        }, 3000);
      } else {
        console.error('❌ 手动代理切换失败:', response.error);
        setProgress(`❌ 代理切换失败: ${response.error}`);

        // 显示错误消息
        setTimeout(() => {
          setProgress('');
        }, 5000);
      }
    } catch (error) {
      console.error('❌ 发送代理切换请求失败:', error);
      setProgress(`❌ 代理切换请求失败: ${error instanceof Error ? error.message : '未知错误'}`);

      // 显示错误消息
      setTimeout(() => {
        setProgress('');
      }, 5000);
    }
  };

  const fetchUsers = async (page: number = 1, size: number = 10): Promise<ApiResponse> => {
    const response = await fetch(`http://${apiServerHost}/open/crawler/twitter_smart_user/page`, {
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
    const response = await fetch(`http://${apiServerHost}/open/crawler/twitter_smart_user/update`, {
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

  const fetchUserById = async (id: number): Promise<TwitterUser | null> => {
    try {
      console.log(`获取用户详细信息，ID: ${id}`);
      // 尝试多页查询来找到特定用户，提高查找效率
      for (let page = 1; page <= 5; page++) {
        const response = await fetch(`http://${apiServerHost}/open/crawler/twitter_smart_user/page`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ page, size: 50 }), // 每页50个用户
        });

        if (!response.ok) {
          throw new Error(`请求失败: ${response.status}`);
        }

        const result: ApiResponse = await response.json();
        const user = result.data.list.find(u => u.id === id);

        if (user) {
          console.log(`✅ 成功获取用户 ${user.screenName} 的详细信息，followingCount: ${user.followingCount}`);
          return user;
        }

        // 如果当前页没有更多数据，停止查询
        if (result.data.list.length < 50) {
          break;
        }
      }

      console.warn(`⚠️ 未找到ID为 ${id} 的用户`);
      return null;
    } catch (error) {
      console.error(`获取用户 ${id} 详细信息失败:`, error);
      return null;
    }
  };

  const fetchUsersForRetry = async (failedUserIds: number[]): Promise<Map<number, TwitterUser>> => {
    const userMap = new Map<number, TwitterUser>();

    try {
      console.log(`🔍 批量获取 ${failedUserIds.length} 个失败用户的最新数据...`);

      // 批量查询，最多查询前5页来覆盖大部分用户
      for (let page = 1; page <= 5; page++) {
        console.log(`查询第 ${page} 页数据...`);
        const response = await fetch(`http://${apiServerHost}/open/crawler/twitter_smart_user/page`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ page, size: 50 }),
        });

        if (!response.ok) {
          console.warn(`第 ${page} 页查询失败: ${response.status}`);
          continue;
        }

        const result: ApiResponse = await response.json();

        // 查找失败用户
        result.data.list.forEach(user => {
          if (failedUserIds.includes(user.id)) {
            userMap.set(user.id, user);
            console.log(`✅ 找到用户 ${user.screenName} (ID:${user.id}) followingCount: ${user.followingCount}`);
          }
        });

        // 如果当前页没有更多数据，停止查询
        if (result.data.list.length < 50) {
          break;
        }

        // 如果已经找到所有用户，提前退出
        if (userMap.size === failedUserIds.length) {
          console.log(`✅ 已找到所有 ${failedUserIds.length} 个失败用户的数据`);
          break;
        }
      }

      console.log(`🔍 批量查询完成，找到 ${userMap.size}/${failedUserIds.length} 个用户的数据`);
      return userMap;
    } catch (error) {
      console.error(`批量获取用户数据失败:`, error);
      return userMap;
    }
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

    // 停止操作时也关闭所有标签页
    console.log('停止操作，开始关闭所有标签页...');
    try {
      const closeResult = await closeAllTabs();
      if (closeResult.success && closeResult.closedCount > 0) {
        console.log(`✅ 停止时成功关闭了 ${closeResult.closedCount} 个标签页`);
      } else if (closeResult.closedCount === 0) {
        console.log('📝 停止时没有需要关闭的标签页');
      } else {
        console.warn('⚠️ 停止时关闭标签页出现部分错误:', closeResult.errors);
      }
    } catch (closeError) {
      console.error('❌ 停止时关闭标签页失败:', closeError);
    }

    operationIdRef.current = null;
    baseOperationIdRef.current = null;
    setProgress('操作已停止');
    setCurrentUser(null);
    setCurrentRound(1);
  };

  // 辅助函数：更新统计数据
  const updateStats = (isRetryMode: boolean, updates: Partial<ProcessStats>) => {
    if (isRetryMode) {
      setRetryStats(prev => ({ ...prev, ...updates }));
      retryStatsRef.current = { ...retryStatsRef.current, ...updates };
    } else {
      setStats(prev => ({ ...prev, ...updates }));
      statsRef.current = { ...statsRef.current, ...updates };
    }
  };

  // 辅助函数：增量更新统计数据
  const incrementStats = (isRetryMode: boolean, increments: Partial<ProcessStats>) => {
    if (isRetryMode) {
      setRetryStats(prev => ({
        ...prev,
        total: prev.total + (increments.total || 0),
        processed: prev.processed + (increments.processed || 0),
        successful: prev.successful + (increments.successful || 0),
        failed: prev.failed + (increments.failed || 0),
        changed: prev.changed + (increments.changed || 0),
        skipped: prev.skipped + (increments.skipped || 0),
      }));
      retryStatsRef.current = {
        ...retryStatsRef.current,
        total: retryStatsRef.current.total + (increments.total || 0),
        processed: retryStatsRef.current.processed + (increments.processed || 0),
        successful: retryStatsRef.current.successful + (increments.successful || 0),
        failed: retryStatsRef.current.failed + (increments.failed || 0),
        changed: retryStatsRef.current.changed + (increments.changed || 0),
        skipped: retryStatsRef.current.skipped + (increments.skipped || 0),
      };
    } else {
      setStats(prev => ({
        ...prev,
        total: prev.total + (increments.total || 0),
        processed: prev.processed + (increments.processed || 0),
        successful: prev.successful + (increments.successful || 0),
        failed: prev.failed + (increments.failed || 0),
        changed: prev.changed + (increments.changed || 0),
        skipped: prev.skipped + (increments.skipped || 0),
      }));
      statsRef.current = {
        ...statsRef.current,
        total: statsRef.current.total + (increments.total || 0),
        processed: statsRef.current.processed + (increments.processed || 0),
        successful: statsRef.current.successful + (increments.successful || 0),
        failed: statsRef.current.failed + (increments.failed || 0),
        changed: statsRef.current.changed + (increments.changed || 0),
        skipped: statsRef.current.skipped + (increments.skipped || 0),
      };
    }
  };

  // 新增：检查代理切换的函数
  const checkProxySwitch = async () => {
    try {
      const currentProcessed = statsRef.current.processed;
      console.log(`检查代理切换: 当前已处理用户数 ${currentProcessed}`);

      const response = await chrome.runtime.sendMessage({
        action: 'checkProxySwitch',
        processedCount: currentProcessed,
      });

      if (response.success && response.switched) {
        console.log('✅ 代理切换成功');
        // 不需要显示通知，因为background会发送proxyChanged消息
      } else if (response.success && !response.switched) {
        console.log(`代理切换检查: ${response.reason || '未达到切换条件'}`);
      } else {
        console.warn('代理切换检查失败:', response.error);
      }
    } catch (error) {
      console.error('代理切换检查时出错:', error);
    }
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
        // 重试模式下失败的用户也要记录，等待下一轮重试
        saveFailedUser(user, error);

        if (isRetryMode) {
          incrementStats(true, { processed: 1, failed: 1 });
        } else {
          incrementStats(false, { processed: 1, failed: 1 });
        }

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

      incrementStats(isRetryMode, { processed: 1 });

      if (currentFollowingCount !== userFollowingCount) {
        console.log(`🔄 检测到关注数变化，准备验证变化幅度...`);
        const newAdditions = currentFollowingCount - userFollowingCount;
        const changeAmount = Math.abs(newAdditions);

        console.log(
          `用户 ${user.screenName} 关注数变化: ${userFollowingCount} → ${currentFollowingCount} (${newAdditions > 0 ? '+' : ''}${newAdditions})`,
        );
        console.log(`变化幅度: ${changeAmount} 人`);

        // 检查变化幅度是否异常（超过阈值）
        const threshold = parseInt(changeThreshold.trim(), 10) || 50;
        // 如果关注数为0，则不进行验证
        if (changeAmount > threshold && userFollowingCount !== 0) {
          console.warn(`⚠️ 用户 ${user.screenName} 关注数变化幅度异常: ${changeAmount} 人，超过阈值 ${threshold} 人`);
          console.log(`🔄 重新获取 ${user.screenName} 的关注数进行验证...`);

          try {
            // 等待3秒后重新获取
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 重新获取关注数进行验证
            const verifyFollowingCount = await getFollowingCountFromTwitter(user.screenName, operationId, true);
            console.log(`${user.screenName} 验证关注数: ${verifyFollowingCount}`);

            if (verifyFollowingCount === -1) {
              const error = '验证时无法获取关注数据';
              console.error(`用户 ${user.screenName} ${error}`);
              // 重试模式下失败的用户也要记录，等待下一轮重试
              saveFailedUser(user, error);
              incrementStats(true, { processed: 1, failed: 1 });
              setProgress(`用户 ${user.screenName} (ID: ${user.id}) 验证失败: ${error}`);
              return null;
            }

            const verifyChangeAmount = Math.abs(verifyFollowingCount - userFollowingCount);
            console.log(`验证后的变化幅度: ${verifyChangeAmount} 人`);

            // 如果两次获取的结果一致，且变化幅度仍然很大
            if (verifyFollowingCount === currentFollowingCount && verifyChangeAmount > threshold) {
              console.warn(`❌ 用户 ${user.screenName} 两次获取结果一致但变化幅度仍然异常，标记为可疑数据`);
              const error = `关注数变化异常: ${userFollowingCount} → ${currentFollowingCount} (变化${changeAmount}人)`;
              // 重试模式下失败的用户也要记录，等待下一轮重试
              saveFailedUser(user, error);
              incrementStats(true, { processed: 1, failed: 1 });
              setProgress(`用户 ${user.screenName} (ID: ${user.id}) 数据异常: ${error}`);
              return null;
            }

            // 如果验证结果不同，使用验证结果
            if (verifyFollowingCount !== currentFollowingCount) {
              console.log(`🔄 验证结果不同，使用验证结果: ${currentFollowingCount} → ${verifyFollowingCount}`);
              // 更新为验证后的结果
              const finalFollowingCount = verifyFollowingCount;
              const finalNewAdditions = finalFollowingCount - userFollowingCount;
              const finalChangeAmount = Math.abs(finalNewAdditions);

              // 如果验证后的变化幅度仍然过大
              if (finalChangeAmount > threshold) {
                console.warn(`❌ 用户 ${user.screenName} 验证后变化幅度仍然异常: ${finalChangeAmount} 人`);
                const error = `验证后关注数变化仍异常: ${userFollowingCount} → ${finalFollowingCount} (变化${finalChangeAmount}人)`;
                // 重试模式下失败的用户也要记录，等待下一轮重试
                saveFailedUser(user, error);
                incrementStats(true, { processed: 1, failed: 1 });
                setProgress(`用户 ${user.screenName} (ID: ${user.id}) 验证后数据仍异常: ${error}`);
                return null;
              }

              // 使用验证后的数据更新
              try {
                // 在重试模式下，任何变化都要更新数据库；在正常模式下，只要有变化就更新
                const shouldUpdate = finalNewAdditions !== 0;

                if (shouldUpdate) {
                  console.log(
                    `📞 使用验证数据${isRetryMode ? '(重试模式)' : ''}调用 updateUser(${user.id}, ${finalFollowingCount}, ${finalNewAdditions})...`,
                  );
                  await updateUser(user.id, finalFollowingCount, finalNewAdditions);
                  console.log(
                    `✅ 成功更新用户 ${user.screenName} 的数据库记录(验证后${isRetryMode ? '-重试模式' : ''})`,
                  );
                } else {
                  console.log(
                    `📝 验证后${isRetryMode ? '重试模式下无变化' : '正常模式下无变化'}，跳过数据库更新 - ${user.screenName}`,
                  );
                }
              } catch (updateError) {
                console.error(`❌ 更新用户 ${user.screenName} 数据库记录失败:`, updateError);
              }

              // 验证后检查是否真的有变化
              if (finalNewAdditions === 0) {
                console.log(`🔍 验证后确认无变化: finalNewAdditions = ${finalNewAdditions}，不返回变化信息`);

                if (isRetryMode) {
                  console.log(`重试成功(验证后无变化)，从失败列表中移除用户 ${user.screenName}`);
                  const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
                  localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
                  setFailedUsers(updatedFailedUsers);
                }

                incrementStats(isRetryMode, { successful: 1, skipped: 1 });

                return null; // 不返回changeInfo，因为验证后实际没有变化
              }

              const changeInfo = `${user.screenName} (ID: ${user.id}): ${userFollowingCount} → ${finalFollowingCount} (${finalNewAdditions > 0 ? '+' : ''}${finalNewAdditions}) [已验证]`;

              incrementStats(isRetryMode, { successful: 1, changed: 1 });

              // 成功处理用户后检查代理切换
              await checkProxySwitch();

              console.log(
                `用户 ${user.screenName} 关注数从 ${userFollowingCount} 变为 ${finalFollowingCount} (已验证)`,
              );

              if (isRetryMode) {
                console.log(`重试成功，从失败列表中移除用户 ${user.screenName}`);
                const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
                localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
                setFailedUsers(updatedFailedUsers);
              }

              return changeInfo;
            }

            console.log(`✅ 验证成功，数据一致，变化幅度正常: ${verifyChangeAmount} 人`);
            // 验证成功后，重新检查是否真的有变化
            if (verifyFollowingCount === userFollowingCount) {
              // 验证后发现实际没有变化，应该跳到无变化的处理逻辑
              console.log(`🔍 验证后发现实际无变化: ${userFollowingCount} → ${verifyFollowingCount}，跳过更新数据库`);

              if (isRetryMode) {
                console.log(`重试成功(验证后无变化)，从失败列表中移除用户 ${user.screenName}`);
                const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
                localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
                setFailedUsers(updatedFailedUsers);
              }

              incrementStats(isRetryMode, { successful: 1, skipped: 1 });

              // 成功处理用户后检查代理切换
              await checkProxySwitch();

              return null; // 不返回changeInfo，因为验证后实际没有变化
            }
          } catch (verifyError) {
            console.error(`验证 ${user.screenName} 关注数时出错:`, verifyError);
            const error = `验证关注数失败: ${verifyError instanceof Error ? verifyError.message : '未知错误'}`;
            if (!isRetryMode) {
              saveFailedUser(user, error);
            }
            incrementStats(false, { processed: 1, failed: 1 });
            setProgress(`用户 ${user.screenName} (ID: ${user.id}) 验证失败: ${error}`);
            return null;
          }
        }

        // 正常更新数据库
        try {
          // 在重试模式下，任何变化都要更新数据库；在正常模式下，只要有变化就更新
          const shouldUpdate = newAdditions !== 0;

          if (shouldUpdate) {
            console.log(
              `📞 ${isRetryMode ? '重试模式' : '正常模式'}调用 updateUser(${user.id}, ${currentFollowingCount}, ${newAdditions})...`,
            );
            await updateUser(user.id, currentFollowingCount, newAdditions);
            console.log(`✅ 成功更新用户 ${user.screenName} 的数据库记录${isRetryMode ? '(重试模式)' : ''}`);
          } else {
            console.log(
              `📝 ${isRetryMode ? '重试模式下无变化' : '正常模式下无变化'}，跳过数据库更新 - ${user.screenName}`,
            );
          }
        } catch (updateError) {
          console.error(`❌ 更新用户 ${user.screenName} 数据库记录失败:`, updateError);
        }

        // 最终检查是否真的有变化
        if (newAdditions === 0) {
          console.log(`🔍 最终确认无变化: newAdditions = ${newAdditions}，不返回变化信息`);

          if (isRetryMode) {
            console.log(`重试成功(最终确认无变化)，从失败列表中移除用户 ${user.screenName}`);
            const updatedFailedUsers = failedUsers.filter(u => u.id !== user.id);
            localStorage.setItem('failedTwitterUsers', JSON.stringify(updatedFailedUsers));
            setFailedUsers(updatedFailedUsers);
          }

          incrementStats(isRetryMode, { successful: 1, skipped: 1 });

          // 成功处理用户后检查代理切换
          await checkProxySwitch();

          return null; // 不返回changeInfo，因为实际没有变化
        }

        const changeInfo = `${user.screenName} (ID: ${user.id}): ${userFollowingCount} → ${currentFollowingCount} (${newAdditions > 0 ? '+' : ''}${newAdditions})`;

        incrementStats(isRetryMode, { successful: 1, changed: 1 });

        // 成功处理用户后检查代理切换
        await checkProxySwitch();

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
        incrementStats(isRetryMode, { successful: 1, skipped: 1 });

        // 成功处理用户后检查代理切换
        await checkProxySwitch();
      }

      return null;
    } catch (error) {
      if (error instanceof Error && error.message === 'PAUSED') {
        console.log(`用户 ${user.screenName} 处理被暂停`);
        return null;
      }

      console.error(`处理用户 ${user.screenName} 时出错:`, error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';

      // 重试模式下失败的用户也要记录，等待下一轮重试
      saveFailedUser(user, errorMsg);

      incrementStats(false, { processed: 1, failed: 1 });
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
        // 随机延迟
        const waitTime =
          Math.floor(
            Math.random() * (parseInt(randomDelayMax, 10) - parseInt(randomDelayMin, 10) + 1) +
              parseInt(randomDelayMin, 10),
          ) * 1000;
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
        const waitTime =
          Math.floor(
            Math.random() * (parseInt(randomDelayMax, 10) - parseInt(randomDelayMin, 10) + 1) +
              parseInt(randomDelayMin, 10),
          ) * 1000;
        console.log(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        setProgress(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    setIsRetrying(false);
    return retryResults;
  };

  // 分组处理失败用户（10个用户为一组）
  const processFailedUsersInGroups = async (): Promise<string[]> => {
    // 在函数开始时立即获取当前失败用户数据，确保与外部调用时的数据一致
    const currentFailedUsers = JSON.parse(localStorage.getItem('failedTwitterUsers') || '[]') as FailedUser[];

    console.log(`📊 processFailedUsersInGroups 数据一致性检查: 函数内获取到 ${currentFailedUsers.length} 个失败用户`);
    console.log(`🔍 失败用户详情:`, currentFailedUsers.map(u => `${u.screenName}(ID:${u.id})`).join(', '));

    if (currentFailedUsers.length === 0) {
      console.log('没有需要重试的失败用户');
      return [];
    }

    console.log(`开始分组处理 ${currentFailedUsers.length} 个失败用户，每组10个用户`);
    setIsRetrying(true);

    // 初始化重试统计数据
    const initialRetryStats = {
      total: currentFailedUsers.length,
      processed: 0,
      successful: 0,
      failed: 0,
      changed: 0,
      skipped: 0,
    };
    setRetryStats(initialRetryStats);
    retryStatsRef.current = initialRetryStats;

    // 批量获取所有失败用户的最新数据
    const failedUserIds = currentFailedUsers.map(u => u.id);
    console.log(`🔄 开始批量获取 ${failedUserIds.length} 个失败用户的最新数据...`);
    setProgress(prev => `${prev}\n🔄 批量获取失败用户最新数据中...`);

    const userDataMap = await fetchUsersForRetry(failedUserIds);
    console.log(`✅ 批量数据获取完成，成功获取 ${userDataMap.size}/${failedUserIds.length} 个用户的最新数据`);

    const allRetryResults: string[] = [];
    const groupSize = 10;
    const totalGroups = Math.ceil(currentFailedUsers.length / groupSize);

    console.log(
      `📋 分组计划: 总共 ${currentFailedUsers.length} 个用户，每组 ${groupSize} 个，共分为 ${totalGroups} 组`,
    );

    let retryOperationId: string;
    if (isContinuousMode && baseOperationIdRef.current) {
      retryOperationId = `${baseOperationIdRef.current}-retry`;
    } else {
      retryOperationId = `${operationIdRef.current}-retry`;
    }

    console.log(`失败用户重试操作ID: ${retryOperationId}, 总共分为 ${totalGroups} 组`);

    // 创建所有组的处理Promise，实现并行处理
    const groupProcessingPromises: Promise<string[]>[] = [];

    for (let groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
      const startIndex = groupIndex * groupSize;
      const endIndex = Math.min(startIndex + groupSize, currentFailedUsers.length);
      const groupUsers = currentFailedUsers.slice(startIndex, endIndex);

      // 为每组创建独立的操作ID，确保每组使用独立的标签页
      const groupOperationId = `${retryOperationId}-group-${groupIndex + 1}`;

      console.log(`🔄 准备第 ${groupIndex + 1}/${totalGroups} 组失败用户处理，包含 ${groupUsers.length} 个用户`);
      console.log(
        `📋 第 ${groupIndex + 1} 组用户列表: ${groupUsers.map(u => `${u.screenName}(ID:${u.id})`).join(', ')}`,
      );
      console.log(`📊 第 ${groupIndex + 1} 组使用独立操作ID: ${groupOperationId}`);

      // 创建组处理函数
      const processGroup = async (gIndex: number, gUsers: FailedUser[], gOperationId: string): Promise<string[]> => {
        console.log(`🚀 第 ${gIndex + 1} 组开始并行处理...`);
        setProgress(prev => `${prev}\n🔄 第 ${gIndex + 1}/${totalGroups} 组开始处理 (${gUsers.length} 个用户)...`);

        const groupRetryResults: string[] = [];

        for (let i = 0; i < gUsers.length; i++) {
          if (shouldStopRef.current) break;

          const failedUser = gUsers[i];
          const isFirstUserInGroup = i === 0;

          // 每组的第一个用户创建新标签页，组内其他用户复用标签页
          const reuseTab = isFirstUserInGroup ? false : true;

          console.log(
            `重试用户 ${failedUser.screenName} (组${gIndex + 1}/${totalGroups}, 用户${i + 1}/${gUsers.length}): 复用标签页=${reuseTab}${isFirstUserInGroup ? ' [组首用户-新标签页]' : ' [组内用户-复用标签页]'}`,
          );

          // 在每组第一个用户处理前，明确标签页策略
          if (isFirstUserInGroup) {
            console.log(`🚀 第 ${gIndex + 1} 组开始处理，组首用户 ${failedUser.screenName} 将创建新标签页`);
            console.log(`📊 操作ID: ${gOperationId}, reuseTab: ${reuseTab}`);
          }

          // 使用批量获取的用户数据
          const latestUserData = userDataMap.get(failedUser.id);

          let userForRetry: TwitterUser;
          if (latestUserData) {
            // 使用从API获取的最新数据
            userForRetry = latestUserData;
            console.log(
              `✅ 使用批量获取的最新数据: ${failedUser.screenName} followingCount=${latestUserData.followingCount}`,
            );
          } else {
            // 如果批量获取中没有找到，尝试单独获取
            console.warn(`⚠️ 批量获取中未找到 ${failedUser.screenName} 的数据，尝试单独获取...`);
            const singleUserData = await fetchUserById(failedUser.id);

            if (singleUserData) {
              userForRetry = singleUserData;
              console.log(`✅ 单独获取成功: ${failedUser.screenName} followingCount=${singleUserData.followingCount}`);
            } else {
              // 如果都获取失败，使用失败列表中的基本信息，但followingCount设为0（这种情况下会有问题，但至少能继续处理）
              console.warn(`⚠️ 无法获取 ${failedUser.screenName} 的最新数据，使用基本信息但followingCount=0`);
              userForRetry = {
                id: failedUser.id,
                screenName: failedUser.screenName,
                name: failedUser.name,
                followingCount: 0, // 如果API获取失败，这里的0会导致对比问题
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
            }
          }

          const result = await processSingleUser(
            userForRetry,
            gOperationId, // 使用组专用的操作ID
            true,
            reuseTab,
          );
          if (result) {
            groupRetryResults.push(result);
          }

          // 组内用户之间的延迟
          if (i < gUsers.length - 1 && !shouldStopRef.current) {
            const waitTime =
              Math.floor(
                Math.random() * (parseInt(randomDelayMax, 10) - parseInt(randomDelayMin, 10) + 1) +
                  parseInt(randomDelayMin, 10),
              ) * 1000;
            console.log(`失败用户 ${failedUser.screenName} 重试完成，等待 ${waitTime / 1000} 秒后处理下一个用户...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }

        console.log(
          `✅ 第 ${gIndex + 1}/${totalGroups} 组处理完成，发现 ${groupRetryResults.length} 个用户关注数有变化`,
        );
        setProgress(prev => `${prev}\n✅ 第 ${gIndex + 1} 组完成，发现 ${groupRetryResults.length} 个变化`);

        return groupRetryResults;
      };

      // 将组处理Promise加入数组
      groupProcessingPromises.push(processGroup(groupIndex, groupUsers, groupOperationId));
    }

    console.log(`🚀 开始并行处理 ${totalGroups} 个组，每组独立创建标签页...`);
    setProgress(prev => `${prev}\n🚀 ${totalGroups} 个组开始并行处理...`);

    // 并行等待所有组完成
    try {
      const allGroupResults = await Promise.all(groupProcessingPromises);

      // 合并所有组的结果
      allGroupResults.forEach(groupResult => {
        allRetryResults.push(...groupResult);
      });

      console.log(`🎉 所有 ${totalGroups} 个组并行处理完成`);
      setProgress(prev => `${prev}\n🎉 所有组并行处理完成`);
    } catch (error) {
      console.error('并行处理组时出错:', error);
      setProgress(prev => `${prev}\n❌ 并行处理出现错误: ${error instanceof Error ? error.message : '未知错误'}`);
    }

    setIsRetrying(false);
    console.log(`所有失败用户分组处理完成，总共发现 ${allRetryResults.length} 个用户关注数有变化`);
    console.log(`🔍 重试处理详细统计:`);
    console.log(`- 总处理用户: ${retryStatsRef.current.total} 个`);
    console.log(`- 成功处理: ${retryStatsRef.current.successful} 个`);
    console.log(`- 处理失败: ${retryStatsRef.current.failed} 个`);
    console.log(`- 发现变化: ${retryStatsRef.current.changed} 个`);
    console.log(`- 无变化: ${retryStatsRef.current.skipped} 个`);
    console.log(`- 变化用户列表: [${allRetryResults.join(', ')}]`);

    if (allRetryResults.length > 0) {
      console.log(
        `🎉 重试模式下发现 ${allRetryResults.length} 个用户关注数有变化，这些变化已通过updateUser接口更新到数据库`,
      );
    }

    return allRetryResults;
  };

  // 新增：执行轮次间操作的函数
  const executeRoundTransitionOperations = async (isErrorRetry: boolean = false): Promise<void> => {
    const operationType = isErrorRetry ? '错误重试' : '正常轮次切换';
    console.log(`🔄 连续监听模式${operationType}：开始执行轮次间操作...`);
    setProgress(prev => `${prev}\n🔄 连续监听模式${operationType}：开始执行轮次间操作...`);

    // 1. 清除浏览器缓存
    console.log('🧹 步骤1: 清除浏览器缓存...');
    setProgress(prev => `${prev}\n🧹 步骤1: 清除浏览器缓存...`);
    try {
      const clearResponse = await chrome.runtime.sendMessage({
        action: 'clearSiteData',
      });

      if (clearResponse.success) {
        console.log('✅ 浏览器缓存清除成功');
        setProgress(prev => `${prev}\n✅ 浏览器缓存清除成功`);
      } else {
        console.warn('⚠️ 浏览器缓存清除失败:', clearResponse.error);
        setProgress(prev => `${prev}\n⚠️ 浏览器缓存清除失败: ${clearResponse.error || '未知错误'}`);
      }
    } catch (clearError) {
      console.error('❌ 清除浏览器缓存时出错:', clearError);
      setProgress(
        prev => `${prev}\n❌ 清除浏览器缓存失败: ${clearError instanceof Error ? clearError.message : '未知错误'}`,
      );
    }

    // 等待2秒
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. 切换代理
    console.log('🔄 步骤2: 切换代理...');
    setProgress(prev => `${prev}\n🔄 步骤2: 切换代理...`);
    try {
      const proxyResponse = await chrome.runtime.sendMessage({
        action: 'switchProxy',
      });

      if (proxyResponse.success) {
        console.log('✅ 代理切换成功:', proxyResponse);
        setProgress(prev => `${prev}\n✅ 代理切换成功`);
      } else {
        console.warn('⚠️ 代理切换失败:', proxyResponse.error);
        setProgress(prev => `${prev}\n⚠️ 代理切换失败: ${proxyResponse.error || '未知错误'}`);
      }
    } catch (proxyError) {
      console.error('❌ 切换代理时出错:', proxyError);
      setProgress(prev => `${prev}\n❌ 代理切换失败: ${proxyError instanceof Error ? proxyError.message : '未知错误'}`);
    }
  };

  const updateFollowingCounts = async (isNewRound: boolean = false) => {
    console.log('🔥 updateFollowingCounts 函数开始执行，参数:', { isNewRound });
    console.log('🔥 当前状态:', {
      isLoading,
      isRetrying,
      targetCount,
      apiServerHost,
      randomDelayMin,
      randomDelayMax,
      changeThreshold,
    });

    try {
      if (isLoading && !isNewRound) {
        console.log('已经有操作在进行中，请等待完成或停止当前操作');
        return;
      }

      const targetNumber = parseInt(targetCount.trim(), 10);
      if (!targetCount.trim() || isNaN(targetNumber) || targetNumber <= 0) {
        console.log('❌ 目标处理条数验证失败:', { targetCount: targetCount.trim(), targetNumber });
        setProgress('❌ 请输入有效的处理条数（大于0的整数）');
        return;
      }

      console.log('✅ 验证通过，开始处理:', { targetNumber });

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
      updateStats(false, { total: 0, processed: 0, successful: 0, failed: 0, changed: 0, skipped: 0 });
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
        console.log('正在获取第一页数据...');
        const firstPageData = await fetchUsers(1, 10);
        console.log('第一页数据获取成功:', firstPageData);
        const apiTotal = firstPageData.data.pagination.total;

        const actualTotal = Math.min(targetNumber, apiTotal);
        const totalPages = Math.ceil(actualTotal / 10);

        updateStats(false, { total: actualTotal });
        statsRef.current = { ...statsRef.current, total: actualTotal };

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

        // 正常用户处理完成后，开始处理失败用户
        if (!shouldStopRef.current) {
          // 在处理失败用户前，先获取当前的失败用户数据，确保数据一致性
          const currentFailedUsers = JSON.parse(localStorage.getItem('failedTwitterUsers') || '[]') as FailedUser[];
          const finalFailedCount = currentFailedUsers.length;

          const finalStats = statsRef.current;
          const completionMessage = `✅ 第 ${currentRound} 轮正常用户处理完成！共处理 ${finalStats.processed} 个用户，成功 ${finalStats.successful}，失败 ${finalStats.failed}，无变化 ${finalStats.skipped}，发现 ${finalStats.changed} 个用户关注数有变化。${finalFailedCount > 0 ? `检测到 ${finalFailedCount} 个失败用户，即将开始重试...` : ''}`;
          setProgress(completionMessage);
          console.log(completionMessage);
          console.log('正常用户处理完成，统计详情:', finalStats);

          // 在本轮完成后立即处理失败用户
          if (finalFailedCount > 0 && !shouldStopRef.current) {
            console.log(
              `📊 外部调用数据一致性检查: 正常统计显示失败 ${finalStats.failed} 个，localStorage中有 ${finalFailedCount} 个失败用户`,
            );
            console.log(`🔍 外部失败用户详情:`, currentFailedUsers.map(u => `${u.screenName}(ID:${u.id})`).join(', '));
            console.log(`开始处理 ${finalFailedCount} 个失败用户...`);
            setProgress(prev => `${prev}\n🔄 开始重试 ${finalFailedCount} 个失败用户...`);

            // 先关闭其他已成功的标签页
            console.log('重试失败用户前，先关闭其他已成功的标签页...');
            setProgress(prev => `${prev}\n🗂️ 关闭其他已成功的标签页中...`);
            try {
              const closeResult = await closeAllTabs();
              if (closeResult.success && closeResult.closedCount > 0) {
                console.log(`✅ 成功关闭了 ${closeResult.closedCount} 个标签页`);
                setProgress(prev => `${prev}\n✅ 成功关闭了 ${closeResult.closedCount} 个标签页`);
              } else if (closeResult.closedCount === 0) {
                console.log('📝 没有需要关闭的标签页');
                setProgress(prev => `${prev}\n📝 没有需要关闭的标签页`);
              } else {
                console.warn('⚠️ 关闭标签页时出现部分错误:', closeResult.errors);
                setProgress(prev => `${prev}\n⚠️ 关闭标签页时出现部分错误`);
              }
            } catch (closeError) {
              console.error('❌ 关闭标签页失败:', closeError);
              setProgress(prev => `${prev}\n⚠️ 关闭标签页失败，继续重试用户`);
            }

            // 等待2秒让标签页关闭完成
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 处理失败用户
            const retryResults = await processFailedUsersInGroups();

            if (retryResults.length > 0) {
              console.log(`失败用户重试完成，发现 ${retryResults.length} 个用户关注数有变化`);
              const existingUsers = JSON.parse(localStorage.getItem('newTwitterUsers') || '[]');
              const updatedUsers = [...retryResults, ...existingUsers];
              localStorage.setItem('newTwitterUsers', JSON.stringify(updatedUsers));
              setNewUsers(updatedUsers);
              setProgress(prev => `${prev}\n✅ 失败用户重试完成，发现 ${retryResults.length} 个用户关注数有变化`);
            } else {
              setProgress(prev => `${prev}\n📝 失败用户重试完成，未发现关注数变化`);
            }
          }

          // 获取最终的失败用户数量（重试后可能有变化）
          const finalFailedCountAfterRetry = JSON.parse(localStorage.getItem('failedTwitterUsers') || '[]').length;
          const finalCompletionMessage = `✅ 第 ${currentRound} 轮全部处理完成！${finalFailedCountAfterRetry > 0 ? `还有 ${finalFailedCountAfterRetry} 个用户处理失败，将在下一轮继续重试。` : '所有用户处理成功！'}`;
          setProgress(prev => `${prev}\n${finalCompletionMessage}`);
          console.log(finalCompletionMessage);

          // 在每轮完成后自动关闭所有标签页
          console.log(`第 ${currentRound} 轮完成，开始关闭所有标签页...`);
          try {
            const closeResult = await closeAllTabs();
            if (closeResult.success && closeResult.closedCount > 0) {
              console.log(`✅ 成功关闭了 ${closeResult.closedCount} 个标签页`);
              setProgress(prev => `${prev}\n🗂️ 已自动关闭 ${closeResult.closedCount} 个标签页`);
            } else if (closeResult.closedCount === 0) {
              console.log('📝 没有需要关闭的标签页');
            } else {
              console.warn('⚠️ 关闭标签页时出现部分错误:', closeResult.errors);
            }
          } catch (closeError) {
            console.error('❌ 关闭标签页失败:', closeError);
          }

          if (isContinuousMode && !shouldStopRef.current) {
            const intervalSeconds = parseInt(roundInterval, 10);
            if (isNaN(intervalSeconds) || intervalSeconds <= 0) {
              setProgress(prev => `${prev}\n❌ 无效的轮次间隔时间，停止连续监听`);
              setIsContinuousMode(false);
            } else {
              // 执行轮次间操作：清除缓存、切换代理
              await executeRoundTransitionOperations(false);

              // 启动倒计时（使用原来的间隔时间）
              console.log(`⏰ 启动倒计时，${intervalSeconds}秒后开始第 ${currentRound + 1} 轮`);
              setProgress(
                prev => `${prev}\n⏰ 连续监听模式已启用，${intervalSeconds} 秒后开始第 ${currentRound + 1} 轮`,
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
        console.error('❌ updateFollowingCounts 函数执行出错:', error);
        const errorMessage = `❌ 第 ${currentRound} 轮错误: ${error instanceof Error ? error.message : '未知错误'}`;
        setProgress(errorMessage);
        console.error(errorMessage);

        if (isContinuousMode && !shouldStopRef.current) {
          // 执行轮次间操作：清除缓存、切换代理
          await executeRoundTransitionOperations(true);

          // 启动错误重试倒计时
          const intervalSeconds = parseInt(roundInterval, 10);
          console.log(`⚠️ 启动错误重试倒计时，${intervalSeconds}秒后重试第 ${currentRound} 轮`);
          setProgress(prev => `${prev}\n⚠️ 将在 ${intervalSeconds} 秒后重试...`);
          startCountdown(intervalSeconds);
          setTimeout(async () => {
            if (!shouldStopRef.current && isContinuousMode) {
              console.log(`⚠️ 错误重试定时器触发，重试第 ${currentRound} 轮`);
              await updateFollowingCounts(true);
            }
          }, intervalSeconds * 1000);
        }
      }
    } finally {
      if (!isContinuousMode || shouldStopRef.current) {
        console.log(`操作结束，操作ID: ${operationIdRef.current}`);

        // 清理操作相关数据
        if (operationIdRef.current && !isContinuousMode) {
          try {
            await chrome.runtime.sendMessage({
              action: 'cleanupOperationData',
              operationId: operationIdRef.current,
            });
            console.log('✅ 操作结束后清理数据完成');
          } catch (cleanupError) {
            console.warn('⚠️ 清理操作数据失败:', cleanupError);
          }
        }

        // 在非连续模式结束或停止时关闭所有标签页
        if (!shouldStopRef.current) {
          // 如果不是因为停止而结束（停止时已经在 stopOperation 中关闭了）
          console.log('操作正常结束，开始关闭所有标签页...');
          try {
            const closeResult = await closeAllTabs();
            if (closeResult.success && closeResult.closedCount > 0) {
              console.log(`✅ 操作结束时成功关闭了 ${closeResult.closedCount} 个标签页`);
            } else if (closeResult.closedCount === 0) {
              console.log('📝 操作结束时没有需要关闭的标签页');
            }
          } catch (closeError) {
            console.error('❌ 操作结束时关闭标签页失败:', closeError);
          }
        }

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
    setFailedUsers([]);
    localStorage.removeItem('failedTwitterUsers');
  };

  // 关闭所有标签页
  const closeAllTabs = async (operationId?: string) => {
    try {
      console.log(`请求关闭标签页，操作ID: ${operationId || '所有'}`);
      const response = await chrome.runtime.sendMessage({
        action: 'closeAllTabs',
        operationId: operationId,
      });

      if (response.success) {
        console.log(`成功关闭 ${response.closedCount} 个标签页`);
        if (response.errors && response.errors.length > 0) {
          console.warn('关闭标签页时有部分错误:', response.errors);
        }
        return {
          success: true,
          closedCount: response.closedCount,
          errors: response.errors || [],
        };
      } else {
        console.error('关闭标签页失败:', response.error);
        return {
          success: false,
          error: response.error,
          closedCount: 0,
          errors: [response.error],
        };
      }
    } catch (error) {
      console.error('关闭标签页请求失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        closedCount: 0,
        errors: [error instanceof Error ? error.message : '未知错误'],
      };
    }
  };

  // 手动清除站点数据
  const clearSiteData = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'clearSiteData',
      });

      if (response.success) {
        setClearSiteDataStatus({
          show: true,
          timestamp: response.timestamp,
          screenName: '手动操作',
          reason: '用户手动触发',
        });

        // 5秒后自动隐藏
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 5000);
      } else {
        console.error('清除站点数据失败:', response.error);
      }
    } catch (error) {
      console.error('清除站点数据请求失败:', error);
    }
  };

  // 手动恢复标签页
  const recoverTabs = async (operationId?: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'recoverTabs',
        operationId: operationId || currentOperationId,
      });

      if (response.success) {
        setClearSiteDataStatus({
          show: true,
          timestamp: response.timestamp,
          screenName: '手动操作',
          reason: `手动恢复标签页成功 (恢复了 ${response.recoveredCount} 个)`,
        });

        // 5秒后自动隐藏
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 5000);
      } else {
        console.error('恢复标签页失败:', response.error);
        setClearSiteDataStatus({
          show: true,
          timestamp: response.timestamp,
          screenName: '手动操作',
          reason: `手动恢复标签页失败: ${response.error}`,
        });

        // 8秒后自动隐藏
        setTimeout(() => {
          setClearSiteDataStatus(prev => (prev ? { ...prev, show: false } : null));
        }, 8000);
      }
    } catch (error) {
      console.error('恢复标签页请求失败:', error);
    }
  };

  // 获取错误恢复状态
  const getErrorRecoveryStatus = async (operationId?: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getErrorRecoveryStatus',
        operationId: operationId || currentOperationId,
      });

      return response.success ? response : null;
    } catch (error) {
      console.error('获取错误恢复状态失败:', error);
      return null;
    }
  };

  return (
    <div className={cn('App', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <header className={cn('App-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <div className="mx-auto max-w-sm p-4">
          <h1 className="mb-4 text-center text-xl font-bold">Twitter 关注数更新工具</h1>

          {/* 配置折叠/展开按钮 */}
          <div className="mb-4">
            <button
              onClick={() => setIsConfigCollapsed(!isConfigCollapsed)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-opacity-80',
                isLight
                  ? 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100'
                  : 'border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600',
              )}>
              <span>⚙️ 配置设置</span>
              <span className={cn('transition-transform duration-200', isConfigCollapsed ? '' : 'rotate-180')}>▼</span>
            </button>
          </div>

          {/* 配置区域 */}
          {!isConfigCollapsed && (
            <div
              className={cn(
                'mb-4 space-y-4 rounded-lg border p-4 transition-all duration-300',
                isLight ? 'border-gray-200 bg-gray-50' : 'border-gray-600 bg-gray-700/30',
              )}>
              {!isLoading && !isRetrying && (
                <div className="">
                  <label
                    htmlFor="apiServerHost"
                    className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    API服务器地址:
                  </label>
                  <input
                    id="apiServerHost"
                    type="text"
                    value={apiServerHost}
                    onChange={e => setApiServerHost(e.target.value)}
                    placeholder="请输入API服务器地址，如: 127.0.0.1:7072"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                      isLight
                        ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                        : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                    )}
                  />
                  <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                    格式: IP:端口 或 域名:端口，不包含http://前缀
                  </p>
                </div>
              )}

              {!isLoading && !isRetrying && (
                <div className="">
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

              {!isLoading && !isRetrying && (
                <div className="mb-4">
                  <label
                    htmlFor="changeThreshold"
                    className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    变化阈值 (人):
                  </label>
                  <input
                    id="changeThreshold"
                    type="number"
                    min="1"
                    max="500"
                    value={changeThreshold}
                    onChange={e => setChangeThreshold(e.target.value)}
                    placeholder="50"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                      isLight
                        ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                        : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                    )}
                  />
                  <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                    关注数变化超过此值时会触发二次验证，建议20-100
                  </p>
                </div>
              )}

              {!isLoading && !isRetrying && (
                <div className="mb-4">
                  <label className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    随机延迟时间 (秒):
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <input
                        id="randomDelayMin"
                        type="number"
                        min="1"
                        max="60"
                        value={randomDelayMin}
                        onChange={e => setRandomDelayMin(e.target.value)}
                        placeholder="最小值"
                        className={cn(
                          'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                          isLight
                            ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                            : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                        )}
                      />
                    </div>
                    <span className={cn('flex items-center text-sm', isLight ? 'text-gray-700' : 'text-gray-300')}>
                      -
                    </span>
                    <div className="flex-1">
                      <input
                        id="randomDelayMax"
                        type="number"
                        min="1"
                        max="60"
                        value={randomDelayMax}
                        onChange={e => setRandomDelayMax(e.target.value)}
                        placeholder="最大值"
                        className={cn(
                          'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                          isLight
                            ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                            : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                        )}
                      />
                    </div>
                  </div>
                  <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                    处理每个用户后的随机等待时间，避免请求过于频繁
                  </p>
                </div>
              )}

              {!isLoading && !isRetrying && (
                <div className="mb-4">
                  <label
                    htmlFor="proxyUrl"
                    className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    代理切换API地址:
                  </label>
                  <input
                    id="proxyUrl"
                    type="text"
                    value={proxyUrl}
                    onChange={e => setProxyUrl(e.target.value)}
                    placeholder="http://127.0.0.1:9090/proxies/辣条"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                      isLight
                        ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                        : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                    )}
                  />
                  <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                    代理切换API的完整URL地址
                  </p>
                </div>
              )}

              {!isLoading && !isRetrying && (
                <div className="mb-4">
                  <label
                    htmlFor="proxyConfig"
                    className={cn('mb-2 block text-sm font-medium', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    代理配置列表:
                  </label>
                  <textarea
                    id="proxyConfig"
                    value={proxyConfig}
                    onChange={e => setProxyConfig(e.target.value)}
                    placeholder='[{"name": "日本-联通中转"},{"name": "美国-联通中转"}]'
                    rows={3}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2',
                      isLight
                        ? 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500'
                        : 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400',
                    )}
                  />
                  <p className={cn('mt-1 text-xs', isLight ? 'text-gray-500' : 'text-gray-400')}>
                    JSON格式的代理配置数组，系统会随机选择一个代理进行切换
                  </p>
                  {currentProxy && (
                    <p className={cn('mt-1 text-xs font-medium', isLight ? 'text-green-600' : 'text-green-400')}>
                      当前代理: {currentProxy}
                    </p>
                  )}
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

          {(isLoading || isRetrying || stats.total > 0) && (
            <div
              className={cn(
                'mb-4 rounded-lg border p-3 text-sm',
                isLight ? 'border-blue-200 bg-blue-50' : 'border-blue-700 bg-blue-900/30',
              )}>
              <div className="mb-2 font-semibold">📊 正常模式统计</div>
              <div className="grid grid-cols-2 gap-2">
                <div>总数: {stats.total}</div>
                <div>已处理: {stats.processed}</div>
                <div>成功: {stats.successful}</div>
                <div>失败: {stats.failed}</div>
                <div>无变化: {stats.skipped}</div>
                <div>有变化: {stats.changed}</div>
                <div>进度: {stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0}%</div>
                <div>模式: {isRetrying ? '重试模式' : isLoading ? '处理中' : '已完成'}</div>
              </div>
            </div>
          )}

          {(isRetrying || retryStats.total > 0) && (
            <div
              className={cn(
                'mb-4 rounded-lg border p-3 text-sm',
                isLight ? 'border-orange-200 bg-orange-50' : 'border-orange-700 bg-orange-900/30',
              )}>
              <div className="mb-2 font-semibold">🔄 重试模式统计</div>
              <div className="grid grid-cols-2 gap-2">
                <div>总数: {retryStats.total}</div>
                <div>已处理: {retryStats.processed}</div>
                <div>成功: {retryStats.successful}</div>
                <div>失败: {retryStats.failed}</div>
                <div>无变化: {retryStats.skipped}</div>
                <div>有变化: {retryStats.changed}</div>
                <div>
                  进度: {retryStats.total > 0 ? Math.round((retryStats.processed / retryStats.total) * 100) : 0}%
                </div>
                <div>状态: {isRetrying ? '重试中' : '重试完成'}</div>
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
                (() => {
                  const isButtonDisabled =
                    !targetCount.trim() ||
                    isNaN(parseInt(targetCount.trim(), 10)) ||
                    parseInt(targetCount.trim(), 10) <= 0 ||
                    !changeThreshold.trim() ||
                    isNaN(parseInt(changeThreshold.trim(), 10)) ||
                    parseInt(changeThreshold.trim(), 10) <= 0 ||
                    parseInt(changeThreshold.trim(), 10) > 9999 ||
                    !apiServerHost.trim() ||
                    !randomDelayMin.trim() ||
                    !randomDelayMax.trim() ||
                    isNaN(parseInt(randomDelayMin.trim(), 10)) ||
                    isNaN(parseInt(randomDelayMax.trim(), 10)) ||
                    parseInt(randomDelayMin.trim(), 10) <= 0 ||
                    parseInt(randomDelayMax.trim(), 10) <= 0 ||
                    parseInt(randomDelayMin.trim(), 10) >= parseInt(randomDelayMax.trim(), 10) ||
                    (isContinuousMode &&
                      (!roundInterval.trim() ||
                        isNaN(parseInt(roundInterval.trim(), 10)) ||
                        parseInt(roundInterval.trim(), 10) <= 0 ||
                        parseInt(roundInterval.trim(), 10) > 60));

                  console.log('🔍 按钮禁用状态检查:', {
                    isButtonDisabled,
                    targetCountCheck:
                      !targetCount.trim() ||
                      isNaN(parseInt(targetCount.trim(), 10)) ||
                      parseInt(targetCount.trim(), 10) <= 0,
                    changeThresholdCheck:
                      !changeThreshold.trim() ||
                      isNaN(parseInt(changeThreshold.trim(), 10)) ||
                      parseInt(changeThreshold.trim(), 10) <= 0 ||
                      parseInt(changeThreshold.trim(), 10) > 9999,
                    apiServerHostCheck: !apiServerHost.trim(),
                    randomDelayMinCheck:
                      !randomDelayMin.trim() ||
                      isNaN(parseInt(randomDelayMin.trim(), 10)) ||
                      parseInt(randomDelayMin.trim(), 10) <= 0,
                    randomDelayMaxCheck:
                      !randomDelayMax.trim() ||
                      isNaN(parseInt(randomDelayMax.trim(), 10)) ||
                      parseInt(randomDelayMax.trim(), 10) <= 0,
                    delayCompareCheck: parseInt(randomDelayMin.trim(), 10) >= parseInt(randomDelayMax.trim(), 10),
                    continuousModeCheck:
                      isContinuousMode &&
                      (!roundInterval.trim() ||
                        isNaN(parseInt(roundInterval.trim(), 10)) ||
                        parseInt(roundInterval.trim(), 10) <= 0 ||
                        parseInt(roundInterval.trim(), 10) > 60),
                  });

                  return (
                    <button
                      onClick={() => {
                        console.log('🚀 按钮被点击了！');
                        console.log('当前状态检查:', {
                          isLoading,
                          isRetrying,
                          targetCount: targetCount.trim(),
                          apiServerHost: apiServerHost.trim(),
                          randomDelayMin: randomDelayMin.trim(),
                          randomDelayMax: randomDelayMax.trim(),
                          changeThreshold: changeThreshold.trim(),
                          isContinuousMode,
                          roundInterval: roundInterval.trim(),
                        });
                        updateFollowingCounts(false);
                      }}
                      disabled={isButtonDisabled}
                      className={cn(
                        'flex-1 rounded-lg px-4 py-3 font-bold shadow-lg transition-all duration-200',
                        isButtonDisabled
                          ? isLight
                            ? 'cursor-not-allowed bg-gray-300 text-gray-500'
                            : 'cursor-not-allowed bg-gray-600 text-gray-400'
                          : isLight
                            ? 'transform bg-blue-500 text-white hover:scale-105 hover:bg-blue-600 hover:shadow-xl'
                            : 'transform bg-blue-600 text-white hover:scale-105 hover:bg-blue-700 hover:shadow-xl',
                      )}>
                      {isContinuousMode ? '🔄 开始连续监听' : '🚀 开始更新关注数'}
                    </button>
                  );
                })()
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

            {stats.total > 0 && (
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${(stats.processed / stats.total) * 100}%` }}></div>
              </div>
            )}

            {retryStats.total > 0 && (
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-orange-600 transition-all duration-300"
                  style={{ width: `${(retryStats.processed / retryStats.total) * 100}%` }}></div>
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

            {clearSiteDataStatus && clearSiteDataStatus.show && (
              <div
                className={cn(
                  'rounded-lg border p-3 text-sm transition-all duration-300',
                  // 根据消息类型选择不同的颜色主题
                  clearSiteDataStatus.reason.includes('恢复成功')
                    ? isLight
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-green-700 bg-green-900/30 text-green-200'
                    : clearSiteDataStatus.reason.includes('失败')
                      ? isLight
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-red-700 bg-red-900/30 text-red-200'
                      : isLight
                        ? 'border-purple-200 bg-purple-50 text-purple-800'
                        : 'border-purple-700 bg-purple-900/30 text-purple-200',
                )}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {clearSiteDataStatus.reason.includes('恢复成功')
                      ? '🎉'
                      : clearSiteDataStatus.reason.includes('失败')
                        ? '❌'
                        : '🧹'}
                  </span>
                  <div>
                    <div className="font-semibold">
                      {clearSiteDataStatus.reason.includes('恢复成功')
                        ? '错误页面恢复成功'
                        : clearSiteDataStatus.reason.includes('恢复失败')
                          ? '错误页面恢复失败'
                          : clearSiteDataStatus.reason.includes('错误处理失败')
                            ? '错误处理失败'
                            : '站点数据已清除'}
                    </div>
                    <div className="text-xs opacity-80">
                      用户: {clearSiteDataStatus.screenName} | 时间: {clearSiteDataStatus.timestamp}
                    </div>
                    <div className="text-xs opacity-80">详情: {clearSiteDataStatus.reason}</div>
                  </div>
                </div>
              </div>
            )}

            {proxyChangeStatus && proxyChangeStatus.show && (
              <div
                className={cn(
                  'rounded-lg border p-3 text-sm transition-all duration-300',
                  isLight
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                    : 'border-indigo-700 bg-indigo-900/30 text-indigo-200',
                )}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔄</span>
                  <div>
                    <div className="font-semibold">代理切换成功</div>
                    <div className="text-xs opacity-80">时间: {proxyChangeStatus.timestamp}</div>
                    <div className="text-xs opacity-80">详情: {proxyChangeStatus.reason}</div>
                  </div>
                </div>
              </div>
            )}

            {!isLoading && !isRetrying && (
              <div className="flex gap-2">
                <button
                  onClick={clearSiteData}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm font-medium shadow transition-all duration-200',
                    isLight
                      ? 'bg-purple-500 text-white hover:bg-purple-600 hover:shadow-md'
                      : 'bg-purple-600 text-white hover:bg-purple-700 hover:shadow-md',
                  )}>
                  🧹 清除站点数据
                </button>
                <button
                  onClick={async () => {
                    try {
                      const result = await closeAllTabs();
                      if (result.success && result.closedCount > 0) {
                        setProgress(`🗂️ 手动关闭了 ${result.closedCount} 个标签页`);
                      } else if (result.closedCount === 0) {
                        setProgress('📝 没有需要关闭的标签页');
                      } else {
                        setProgress(`⚠️ 关闭标签页时出现错误: ${result.errors.join(', ')}`);
                      }
                    } catch (error) {
                      setProgress(`❌ 关闭标签页失败: ${error instanceof Error ? error.message : '未知错误'}`);
                    }
                  }}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm font-medium shadow transition-all duration-200',
                    isLight
                      ? 'bg-orange-500 text-white hover:bg-orange-600 hover:shadow-md'
                      : 'bg-orange-600 text-white hover:bg-orange-700 hover:shadow-md',
                  )}>
                  🗂️ 关闭标签页
                </button>
              </div>
            )}

            {!isLoading && !isRetrying && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={switchProxyManually}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm font-medium shadow transition-all duration-200',
                    isLight
                      ? 'bg-indigo-500 text-white hover:bg-indigo-600 hover:shadow-md'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md',
                  )}>
                  🔄 切换代理
                </button>
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
