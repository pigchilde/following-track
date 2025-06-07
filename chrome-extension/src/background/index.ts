import 'webextension-polyfill';
import { exampleThemeStorage } from '@extension/storage';

exampleThemeStorage.get().then(theme => {
  console.log('theme', theme);
});

// 添加全局接口定义
interface Window {
  debugTwitter?: {
    logElements: (selector: string) => number;
    getPageInfo: () => {
      title: string;
      url: string;
      readyState: string;
      bodyText?: string;
      htmlContent?: string;
    };
  };
}

console.log('background script loaded');

// 全局状态管理
let globalPauseState = false;
let currentOperationId: string | null = null;
let retryAttempts = new Map<string, number>(); // 用于记录重试次数

// 监听插件图标点击事件，打开侧边栏
chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  // 在当前窗口打开侧边栏
  if (tab.windowId) {
    await chrome.sidePanel.open({
      windowId: tab.windowId,
    });
  }
});

// 监听来自 side panel 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request);

  if (request.action === 'getFollowingCount') {
    // 更新当前操作ID
    currentOperationId = request.operationId;
    console.log(`设置当前操作ID为: ${currentOperationId}`);

    // 检查是否被暂停
    if (globalPauseState) {
      console.log('操作已被暂停，返回暂停状态');
      sendResponse({ success: false, error: '操作已暂停', paused: true });
      return true;
    }

    // 处理获取 Twitter 关注数的请求
    getFollowingCountFromTwitter(request.screenName, request.operationId)
      .then(count => {
        console.log(`成功获取 ${request.screenName} 的关注数: ${count}，准备返回结果`);
        const response = { success: true, count: count };
        console.log(`发送响应到 SidePanel:`, JSON.stringify(response, null, 2));
        sendResponse(response);
        console.log(`响应已发送完成`);
      })
      .catch(error => {
        console.error('获取关注数时出错:', error);
        const errorResponse = { success: false, error: error.message };
        console.log(`发送错误响应到 SidePanel:`, JSON.stringify(errorResponse, null, 2));
        sendResponse(errorResponse);
        console.log(`错误响应已发送完成`);
      });

    // 返回 true 表示我们会异步发送响应
    return true;
  }

  if (request.action === 'pauseOperation') {
    globalPauseState = true;
    currentOperationId = request.operationId;
    console.log(`操作已暂停，操作ID: ${currentOperationId}`);
    sendResponse({ success: true, message: '操作已暂停' });
    return true;
  }

  if (request.action === 'resumeOperation') {
    globalPauseState = false;
    console.log(`操作已恢复，操作ID: ${currentOperationId} -> null`);
    currentOperationId = null;
    sendResponse({ success: true, message: '操作已恢复' });
    return true;
  }

  if (request.action === 'stopOperation') {
    globalPauseState = false;
    console.log(`操作已停止，操作ID: ${currentOperationId} -> null`);
    currentOperationId = null;
    sendResponse({ success: true, message: '操作已停止' });
    return true;
  }
});

// 等待页面元素加载的辅助函数
function waitForElement(selector: string, timeout: number = 15000): Promise<Element | null> {
  return new Promise(resolve => {
    const startTime = Date.now();

    function check() {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startTime >= timeout) {
        resolve(null);
        return;
      }

      setTimeout(check, 500);
    }

    check();
  });
}

// 等待页面加载完成的函数
function waitForPageLoad(timeout: number = 10000): Promise<void> {
  return new Promise(resolve => {
    const startTime = Date.now();

    function check() {
      if (document.readyState === 'complete') {
        // 页面加载完成后，再等待一下确保动态内容加载
        setTimeout(resolve, 2000);
        return;
      }

      if (Date.now() - startTime >= timeout) {
        resolve();
        return;
      }

      setTimeout(check, 100);
    }

    check();
  });
}

// 在 Twitter 页面获取关注数
const getFollowingCountFromTwitter = async (screenName: string, operationId: string): Promise<number> => {
  console.log(`开始获取 ${screenName} 的关注数...，操作ID: ${operationId}，当前操作ID: ${currentOperationId}`);

  // 检查是否暂停，但不再检查操作ID是否匹配
  if (globalPauseState) {
    console.log('操作被暂停');
    return -1;
  }

  const key = `${operationId}-${screenName}`;
  const currentRetry = retryAttempts.get(key) || 0;

  if (currentRetry >= 3) {
    console.log(`用户 ${screenName} 已重试 3 次，放弃获取`);
    retryAttempts.delete(key);
    return -1;
  }

  let tab: chrome.tabs.Tab | null = null;

  try {
    // 构建 Twitter 用户页面 URL
    const twitterUrl = `https://twitter.com/${screenName}`;
    console.log(`正在打开 Twitter 页面: ${twitterUrl}`);

    // 创建新标签页
    try {
      tab = await chrome.tabs.create({
        url: twitterUrl,
        active: true, // 设置为激活状态
      });
      console.log('标签页创建成功:', tab);
    } catch (tabError) {
      console.error('创建标签页时出错:', tabError);
      throw new Error(`创建标签页失败: ${tabError instanceof Error ? tabError.message : '未知错误'}`);
    }

    if (!tab || !tab.id) {
      throw new Error('无法创建标签页或标签页ID为空');
    }

    console.log(`已创建标签页 ${tab.id}，等待页面加载...`);

    // 等待页面完全加载
    try {
      await waitForTabComplete(tab.id, operationId);
    } catch (loadError) {
      console.error(`标签页 ${tab.id} 加载失败:`, loadError);
      // 即使加载失败，也尝试执行脚本
      console.log('尝试在未完全加载的页面上执行脚本...');
    }

    console.log(`标签页 ${tab.id} 准备抓取数据...`);

    // 注入内容脚本并获取关注数
    let results;
    try {
      console.log(`准备在标签页 ${tab.id} 中执行脚本...`);

      // 先测试基本的脚本注入功能
      console.log('步骤0: 测试基本脚本注入功能...');
      try {
        const testResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            console.log('测试脚本执行成功！');
            return {
              test: 'success',
              url: window.location.href,
              title: document.title,
              timestamp: Date.now(),
            };
          },
        });
        console.log('步骤0完成: 基本脚本注入测试成功:', testResult[0]?.result);
      } catch (testError) {
        console.error('步骤0失败: 基本脚本注入测试失败:', testError);
        throw new Error(`基本脚本注入失败: ${testError instanceof Error ? testError.message : '未知错误'}`);
      }

      // 先注入辅助函数
      console.log('步骤1: 注入辅助函数...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 添加全局调试函数
          (window as any).debugTwitter = {
            logElements: (selector: string) => {
              const elements = document.querySelectorAll(selector);
              console.log(`找到 ${elements.length} 个元素匹配选择器 "${selector}"`);
              elements.forEach((el, i) => {
                console.log(`元素 ${i}:`, el.outerHTML, `内容: "${el.textContent}"`);
              });
              return elements.length;
            },

            getPageInfo: () => {
              return {
                title: document.title,
                url: window.location.href,
                readyState: document.readyState,
                bodyText: document.body ? document.body.textContent?.substring(0, 200) : 'No body',
                htmlContent: document.documentElement.outerHTML.substring(0, 500),
              };
            },
          };
          console.log('辅助函数已注入');
        },
      });
      console.log('步骤1完成: 辅助函数注入成功');

      // 获取页面信息
      console.log('步骤2: 获取页面信息...');
      const pageInfo = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 使用类型断言
          const debugTwitter = (window as any).debugTwitter;
          return (
            debugTwitter?.getPageInfo() || {
              title: document.title,
              url: window.location.href,
              readyState: document.readyState,
            }
          );
        },
      });

      console.log('步骤2完成: 页面信息:', pageInfo[0]?.result);

      // 检查页面上的一些关键元素
      console.log('步骤3: 检查页面关键元素...');
      const elementCheckResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const logs: string[] = [];
          // 使用类型断言
          const debugTwitter = (window as any).debugTwitter;
          if (debugTwitter) {
            logs.push('检查页面上的关键元素...');
            const count1 = debugTwitter.logElements('a[href$="/following"]');
            logs.push(`找到 ${count1} 个 a[href$="/following"] 元素`);
            const count2 = debugTwitter.logElements('span[data-testid="UserFollowing-Count"]');
            logs.push(`找到 ${count2} 个 span[data-testid="UserFollowing-Count"] 元素`);
            const count3 = debugTwitter.logElements('span:contains("following")');
            logs.push(`找到 ${count3} 个 span:contains("following") 元素`);
          } else {
            logs.push('debugTwitter 未找到');
          }
          return { logs, timestamp: Date.now() };
        },
      });
      console.log('步骤3完成: 关键元素检查结果:', elementCheckResult[0]?.result);

      // 执行主要的提取函数
      console.log('步骤4: 执行主要提取函数...');
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const logs: string[] = [];

          logs.push('开始在页面中查找关注数...');

          // 检查页面是否已加载
          if (document.readyState !== 'complete') {
            logs.push('页面尚未完全加载，可能影响数据提取');
          }

          // 记录页面状态用于调试
          logs.push(`页面标题: ${document.title}`);
          logs.push(`页面URL: ${window.location.href}`);
          logs.push(`页面加载状态: ${document.readyState}`);

          // 简化的提取逻辑，先尝试最常见的选择器
          const selectors = [
            'a[href$="/following"] span',
            '[data-testid="UserFollowing-Count"]',
            'a[href*="/following"] span',
          ];

          let result = -1;
          let foundElements = 0;

          for (const selector of selectors) {
            try {
              logs.push(`尝试选择器: ${selector}`);
              const elements = Array.from(document.querySelectorAll(selector));
              foundElements += elements.length;
              logs.push(`选择器 ${selector} 找到 ${elements.length} 个元素`);

              for (const element of elements) {
                const text = element.textContent?.trim();
                if (text) {
                  logs.push(`检查元素文本: "${text}"`);
                  // 简单的数字提取
                  const match = text.match(/(\d+)/);
                  if (match) {
                    const num = parseInt(match[1], 10);
                    if (!isNaN(num) && num >= 0) {
                      logs.push(`成功提取关注数: ${num} (原文本: "${text}")`);
                      result = num;
                      break;
                    }
                  }
                }
              }
              if (result !== -1) break;
            } catch (error) {
              logs.push(`选择器 ${selector} 执行出错: ${error}`);
            }
          }

          logs.push(`总共找到 ${foundElements} 个相关元素`);
          logs.push(`最终结果: ${result}`);

          return {
            result: result,
            logs: logs,
            timestamp: Date.now(),
            elementsFound: foundElements,
          };
        },
      });
      console.log('步骤4完成: 脚本执行结果:', results[0]?.result);

      // 如果结果为空或无效，尝试使用备用方法
      if (
        !results ||
        !results[0] ||
        !results[0].result ||
        results[0].result.result === null ||
        results[0].result.result === undefined ||
        results[0].result.result === -1
      ) {
        console.log('步骤5: 主要提取方法失败，尝试备用方法...');
        results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: backupExtractFollowingCount,
        });
        console.log('步骤5完成: 备用方法执行结果:', results);
      }
    } catch (scriptError) {
      console.error('执行脚本时出错:', scriptError);
      console.error('错误详情:', {
        name: scriptError instanceof Error ? scriptError.name : 'Unknown',
        message: scriptError instanceof Error ? scriptError.message : String(scriptError),
        stack: scriptError instanceof Error ? scriptError.stack : 'No stack trace',
      });
      throw new Error(`执行脚本失败: ${scriptError instanceof Error ? scriptError.message : '未知错误'}`);
    }

    // 关闭标签页
    try {
      if (tab && tab.id) {
        await chrome.tabs.remove(tab.id);
        console.log(`已关闭标签页 ${tab.id}`);
      }
    } catch (closeError) {
      console.warn('关闭标签页时出错:', closeError);
      // 关闭标签页失败不影响结果
    }

    if (results && results[0] && results[0].result !== null && results[0].result !== undefined) {
      let followingCount: number;

      // 检查返回值类型
      if (typeof results[0].result === 'object' && results[0].result && 'result' in results[0].result) {
        // 新的返回格式，包含logs等信息
        const resultData = results[0].result as {
          result: number;
          logs: string[];
          timestamp: number;
          elementsFound: number;
        };
        followingCount = resultData.result;
        console.log('提取过程日志:', resultData.logs);
        console.log('找到的元素数量:', resultData.elementsFound);
      } else {
        // 旧的返回格式，直接是数字
        followingCount = results[0].result as number;
      }

      if (followingCount !== -1) {
        console.log(`成功获取 ${screenName} 的关注数: ${followingCount}`);
        retryAttempts.delete(key); // 成功时清除重试计数
        return followingCount;
      }
    }

    throw new Error('无法获取关注数据');
  } catch (error) {
    console.error(`获取 ${screenName} 关注数时出错:`, error);

    // 确保关闭标签页
    try {
      if (tab && tab.id) {
        await chrome.tabs.remove(tab.id);
        console.log(`已关闭标签页 ${tab.id}`);
      }
    } catch (closeError) {
      console.warn('关闭标签页时出错:', closeError);
    }

    // 增加重试计数
    retryAttempts.set(key, currentRetry + 1);

    if (currentRetry < 2) {
      console.log(`重试第 ${currentRetry + 1} 次获取 ${screenName} 的关注数...`);
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 5000));
      return await getFollowingCountFromTwitter(screenName, operationId);
    } else {
      console.log(`用户 ${screenName} 重试次数已用完，返回 -1`);
      retryAttempts.delete(key);
      return -1;
    }
  }
};

// 等待标签页加载完成
const waitForTabComplete = async (tabId: number, operationId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 15; // 增加到15次尝试
    const timeoutMs = 60000; // 60秒超时

    console.log(`开始等待标签页 ${tabId} 加载完成，最多 ${maxAttempts} 次尝试，超时 ${timeoutMs}ms`);

    const timeoutId = setTimeout(() => {
      console.warn(`标签页 ${tabId} 加载超时 (${timeoutMs}ms)`);
      reject(new Error('页面加载超时'));
    }, timeoutMs);

    // 监听标签页更新事件
    const tabUpdateListener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        console.log(`标签页 ${tabId} 通过事件监听器检测到加载完成`);
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(tabUpdateListener);

        // 等待额外时间确保页面稳定
        setTimeout(async () => {
          try {
            await scrollPageToLoadContent(tabId);
            resolve();
          } catch (error) {
            console.warn('滚动页面失败，但继续处理:', error);
            resolve();
          }
        }, 3000);
      }
    };

    // 添加标签页更新监听器
    try {
      chrome.tabs.onUpdated.addListener(tabUpdateListener);
    } catch (error) {
      console.error('添加标签页更新监听器失败:', error);
    }

    const checkAndWait = async () => {
      try {
        // 检查是否暂停，但不再检查操作ID是否匹配
        if (globalPauseState) {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(tabUpdateListener);
          reject(new Error('操作被暂停'));
          return;
        }

        attempts++;
        console.log(`检查标签页 ${tabId} 状态，第 ${attempts}/${maxAttempts} 次尝试...`);

        // 获取标签页状态
        let tab;
        try {
          tab = await chrome.tabs.get(tabId);
        } catch (error) {
          console.error(`获取标签页 ${tabId} 状态失败:`, error);
          if (attempts >= maxAttempts) {
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(tabUpdateListener);
            reject(new Error(`无法获取标签页状态: ${error instanceof Error ? error.message : '未知错误'}`));
          } else {
            setTimeout(checkAndWait, 2000);
          }
          return;
        }

        if (tab.status === 'complete') {
          console.log(`标签页 ${tabId} 加载完成，等待额外时间确保页面稳定...`);

          // 页面加载完成后，等待额外时间并尝试滚动页面
          await new Promise(resolve => setTimeout(resolve, 3000));

          try {
            await scrollPageToLoadContent(tabId);
          } catch (error) {
            console.warn('滚动页面失败，但继续处理:', error);
          }

          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(tabUpdateListener);
          resolve();
        } else if (attempts >= maxAttempts) {
          console.warn(`标签页 ${tabId} 加载未完成，但已达到最大尝试次数 ${maxAttempts}`);
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(tabUpdateListener);
          reject(new Error(`页面加载失败，已尝试 ${maxAttempts} 次`));
        } else {
          // 继续等待
          setTimeout(checkAndWait, 2000);
        }
      } catch (error) {
        console.error(`检查标签页 ${tabId} 时发生错误:`, error);
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(tabUpdateListener);
        reject(error);
      }
    };

    // 开始检查
    checkAndWait();
  });
};

// 滚动页面以触发动态内容加载
const scrollPageToLoadContent = async (tabId: number): Promise<void> => {
  console.log(`尝试滚动页面 ${tabId} 以触发内容加载...`);

  try {
    // 尝试滚动页面以触发动态内容加载
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        console.log('在页面中执行滚动操作');

        // 先滚到顶部
        window.scrollTo(0, 0);

        // 延迟后滚动到页面中间
        setTimeout(() => {
          console.log('滚动到页面中间');
          window.scrollTo(0, document.body.scrollHeight / 3);
        }, 1000);

        // 再延迟后滚回顶部
        setTimeout(() => {
          console.log('滚回页面顶部');
          window.scrollTo(0, 0);
        }, 2000);

        // 点击页面，尝试激活可能的交互元素
        setTimeout(() => {
          console.log('尝试点击页面');
          document.body.click();
        }, 2500);
      },
    });
    console.log(`已滚动页面 ${tabId} 以触发内容加载`);

    // 再等待一段时间确保动态内容加载
    await new Promise(resolve => setTimeout(resolve, 4000));
  } catch (error) {
    console.error('滚动页面时出错:', error);
    throw error;
  }
};

// 备用方法提取关注数
const backupExtractFollowingCount = (): number => {
  console.log('使用备用方法提取关注数...');

  try {
    // 方法1: 遍历所有包含数字的元素
    const allElements = document.querySelectorAll('*');
    const potentialElements = Array.from(allElements).filter(el => {
      const text = el.textContent?.trim();
      return text && /\d/.test(text) && text.length < 20; // 数字通常不会太长
    });

    console.log(`找到 ${potentialElements.length} 个包含数字的元素`);

    // 先检查包含 following 或 关注 的元素
    for (const el of potentialElements) {
      const text = el.textContent?.trim();
      if (!text) continue;

      if (text.toLowerCase().includes('following') || text.includes('关注')) {
        console.log(`找到关注相关元素: "${text}"`);
        const count = parseFollowingCount(text);
        if (count !== null && count >= 0) {
          console.log(`备用方法1成功提取关注数: ${count}`);
          return count;
        }
      }
    }

    // 方法2: 查找页面中所有数字，选择最可能的一个
    const numberMatches: number[] = [];
    for (const el of potentialElements) {
      const text = el.textContent?.trim();
      if (!text) continue;

      const matches = text.match(/\d+/g);
      if (matches) {
        matches.forEach(match => {
          const num = parseInt(match, 10);
          if (!isNaN(num) && num > 0) {
            numberMatches.push(num);
          }
        });
      }
    }

    console.log(`找到 ${numberMatches.length} 个数字: ${numberMatches.join(', ')}`);

    if (numberMatches.length > 0) {
      // 假设关注数通常在几十到几千之间
      const likelyFollowingCounts = numberMatches.filter(n => n >= 10 && n <= 10000);
      if (likelyFollowingCounts.length > 0) {
        const result = likelyFollowingCounts[0];
        console.log(`备用方法2选择可能的关注数: ${result}`);
        return result;
      }

      // 如果没有符合范围的数字，返回第一个数字
      console.log(`备用方法2返回第一个数字: ${numberMatches[0]}`);
      return numberMatches[0];
    }

    // 方法3: 尝试在页面源码中查找
    const pageSource = document.documentElement.outerHTML;
    const followingMatch = pageSource.match(/following_count\D*(\d+)/i) || pageSource.match(/followingCount\D*(\d+)/i);

    if (followingMatch && followingMatch[1]) {
      const count = parseInt(followingMatch[1], 10);
      if (!isNaN(count) && count >= 0) {
        console.log(`备用方法3从源码提取关注数: ${count}`);
        return count;
      }
    }

    console.log('备用方法都失败了');
    return -1;
  } catch (error) {
    console.error('备用提取方法出错:', error);
    return -1;
  }
};

// 解析关注数文本
const parseFollowingCount = (text: string): number | null => {
  if (!text) return null;

  console.log(`尝试解析文本: "${text}"`);

  // 检查文本是否与关注相关
  const isFollowingRelated =
    text.includes('following') ||
    text.includes('Following') ||
    text.includes('关注') ||
    text.includes('正在关注') ||
    text.match(/\d+[,\.]?\d*\s*(K|M|B|千|万|亿)?/i);

  if (!isFollowingRelated && text.length > 20) {
    // 如果文本不相关且很长，跳过
    return null;
  }

  // 移除逗号和空格
  const cleanText = text.replace(/[,\s]/g, '');

  // 尝试提取数字 + 单位的模式
  const extractNumberWithUnit = (txt: string): number | null => {
    // 匹配数字+单位，或者数字+关注相关文本
    const match =
      txt.match(/(\d+(?:\.\d+)?)(K|M|B|千|万|亿)?/i) ||
      txt.match(/(\d+(?:\.\d+)?)(?=.*(?:following|Following|关注|正在关注))/i);

    if (match) {
      const number = parseFloat(match[1]);
      const unit = match[2]?.toUpperCase();

      switch (unit) {
        case 'K':
        case '千':
          return Math.round(number * 1000);
        case 'M':
        case '万':
          return Math.round(number * (unit === 'M' ? 1000000 : 10000));
        case 'B':
        case '亿':
          return Math.round(number * (unit === 'B' ? 1000000000 : 100000000));
        default:
          return Math.round(number);
      }
    }
    return null;
  };

  // 先尝试匹配完整的数字+单位
  const fullMatch = extractNumberWithUnit(cleanText);
  if (fullMatch !== null) {
    return fullMatch;
  }

  // 如果完整匹配失败，尝试在文本中查找数字
  const numberMatches = cleanText.match(/\d+(?:\.\d+)?/g);
  if (numberMatches && numberMatches.length > 0) {
    // 如果有多个数字，选择最可能是关注数的那个
    for (const numStr of numberMatches) {
      const num = parseFloat(numStr);
      // 关注数通常不会太小
      if (num >= 5) {
        return Math.round(num);
      }
    }
    // 如果没有找到合适的，返回第一个数字
    return Math.round(parseFloat(numberMatches[0]));
  }

  return null;
};

console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.ts' and save to reload.");
