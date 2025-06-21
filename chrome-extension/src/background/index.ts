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
let tabsMap = new Map<string, number>(); // 存储操作ID到标签页ID的映射
let currentTabId: number | null = null; // 添加全局变量跟踪当前标签页ID

// 关闭所有操作相关的标签页
const closeAllOperationTabs = async (
  operationId?: string,
): Promise<{
  closedCount: number;
  errors: string[];
}> => {
  console.log(`开始关闭所有操作相关的标签页，操作ID: ${operationId || '所有'}`);

  let closedCount = 0;
  const errors: string[] = [];

  try {
    // 如果指定了操作ID，只关闭该操作相关的标签页
    if (operationId) {
      const tabId = tabsMap.get(operationId);
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
          console.log(`关闭操作 ${operationId} 的标签页 ${tabId}`);
          tabsMap.delete(operationId);
          closedCount++;
        } catch (error) {
          const errorMsg = `关闭标签页 ${tabId} 失败: ${error instanceof Error ? error.message : '未知错误'}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }
    } else {
      // 关闭所有映射中的标签页
      const tabsToClose = Array.from(tabsMap.entries());
      console.log(`准备关闭 ${tabsToClose.length} 个标签页`);

      for (const [opId, tabId] of tabsToClose) {
        try {
          await chrome.tabs.remove(tabId);
          console.log(`关闭操作 ${opId} 的标签页 ${tabId}`);
          tabsMap.delete(opId);
          closedCount++;
        } catch (error) {
          const errorMsg = `关闭标签页 ${tabId} (操作ID: ${opId}) 失败: ${error instanceof Error ? error.message : '未知错误'}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }
    }

    console.log(`标签页关闭完成，成功关闭 ${closedCount} 个，失败 ${errors.length} 个`);
    return { closedCount, errors };
  } catch (error) {
    const errorMsg = `关闭标签页过程中出错: ${error instanceof Error ? error.message : '未知错误'}`;
    console.error(errorMsg);
    errors.push(errorMsg);
    return { closedCount, errors };
  }
};

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
    getFollowingCountFromTwitter(request.screenName, request.operationId, request.reuseTab || false)
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

  if (request.action === 'closeAllTabs') {
    console.log('收到关闭所有标签页请求');
    closeAllOperationTabs(request.operationId)
      .then((result: { closedCount: number; errors: string[] }) => {
        console.log('关闭标签页成功:', result);
        sendResponse({
          success: true,
          message: `成功关闭 ${result.closedCount} 个标签页`,
          closedCount: result.closedCount,
          errors: result.errors,
        });
      })
      .catch((error: Error) => {
        console.error('关闭标签页失败:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'clearSiteData') {
    console.log('收到清除站点数据请求');
    clearTwitterSiteData()
      .then(() => {
        console.log('站点数据清除成功');
        sendResponse({ success: true, message: '站点数据已清除', timestamp: new Date().toLocaleString() });
      })
      .catch(error => {
        console.error('清除站点数据失败:', error);
        sendResponse({ success: false, error: error.message, timestamp: new Date().toLocaleString() });
      });
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

// 在现有标签页中导航到Twitter用户页面
const navigateToTwitterUser = async (tabId: number, screenName: string): Promise<void> => {
  console.log(`导航到用户 ${screenName} 的页面，标签页ID: ${tabId}`);
  const twitterUrl = `https://twitter.com/${screenName}`;

  try {
    await chrome.tabs.update(tabId, { url: twitterUrl });
    console.log(`标签页 ${tabId} 已导航到 ${twitterUrl}`);
  } catch (error) {
    console.error(`导航到 ${twitterUrl} 失败:`, error);
    throw new Error(`导航失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
};

// 在 Twitter 页面获取关注数
const getFollowingCountFromTwitter = async (
  screenName: string,
  operationId: string,
  reuseTab: boolean = false,
): Promise<number> => {
  console.log(
    `开始获取 ${screenName} 的关注数...，操作ID: ${operationId}，当前操作ID: ${currentOperationId}，重用标签页: ${reuseTab}`,
  );

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

    // 如果重用标签页且有该操作ID对应的标签页
    if (reuseTab && tabsMap.has(operationId)) {
      const tabId = tabsMap.get(operationId)!;
      console.log(`重用标签页 ${tabId} 访问 ${twitterUrl}，操作ID: ${operationId}`);
      try {
        // 检查标签页是否仍然存在
        tab = await chrome.tabs.get(tabId);
        // 导航到新的用户页面
        await navigateToTwitterUser(tabId, screenName);
      } catch (tabError) {
        console.error(`重用标签页 ${tabId} 失败:`, tabError);
        console.log('将创建新标签页');
        tabsMap.delete(operationId); // 移除无效的标签页映射
        reuseTab = false; // 不再尝试重用
      }
    }

    // 如果不重用标签页或重用失败，则创建新标签页
    if (!reuseTab || !tabsMap.has(operationId)) {
      console.log(`正在打开 Twitter 页面: ${twitterUrl}`);
      try {
        tab = await chrome.tabs.create({
          url: twitterUrl,
          active: true, // 设置为激活状态
        });
        console.log('标签页创建成功:', tab);
        if (tab && tab.id) {
          tabsMap.set(operationId, tab.id); // 保存操作ID到标签页ID的映射
          console.log(`更新操作 ${operationId} 的标签页ID为: ${tab.id}`);
        }
      } catch (tabError) {
        console.error('创建标签页时出错:', tabError);
        throw new Error(`创建标签页失败: ${tabError instanceof Error ? tabError.message : '未知错误'}`);
      }
    }

    if (!tab || !tab.id) {
      throw new Error('无法获取有效的标签页或标签页ID为空');
    }

    const tabId = tab.id;
    console.log(`使用标签页 ${tabId} 等待页面加载...`);

    // 等待页面完全加载
    try {
      await waitForTabComplete(tabId, operationId);
    } catch (loadError) {
      console.error(`标签页 ${tabId} 加载失败:`, loadError);
      // 即使加载失败，也尝试执行脚本
      console.log('尝试在未完全加载的页面上执行脚本...');
    }

    console.log(`标签页 ${tabId} 准备抓取数据...`);

    // 额外等待确保页面完全渲染
    console.log('等待额外时间确保页面完全渲染...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 注入内容脚本并获取关注数
    let results;
    try {
      console.log(`准备在标签页 ${tabId} 中执行脚本...`);

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

          // 优先检查是否存在特定的错误页面
          const checkForSpecificError = (): boolean => {
            // 检测用户提到的特定错误页面结构
            const errorTexts = [
              '出错了。请尝试重新加载。',
              '出错了。请尝试重新加载',
              'Something went wrong. Try reloading.',
              'Something went wrong. Try reloading',
            ];

            for (const errorText of errorTexts) {
              // 查找包含错误文本的元素
              const errorElements = Array.from(document.querySelectorAll('*')).filter(el => {
                const text = el.textContent?.trim();
                return text && text.includes(errorText);
              });

              if (errorElements.length > 0) {
                logs.push(`🚨 检测到特定错误页面，找到错误文本: "${errorText}"`);

                // 进一步验证是否确实是错误页面（检查是否有重试按钮）
                const retryButtons = document.querySelectorAll('button[role="button"]');
                let hasRetryButton = false;

                for (const button of Array.from(retryButtons)) {
                  const buttonText = button.textContent?.trim();
                  if (
                    buttonText &&
                    (buttonText.includes('重试') || buttonText.includes('retry') || buttonText.includes('Retry'))
                  ) {
                    hasRetryButton = true;
                    logs.push(`✅ 确认找到重试按钮: "${buttonText}"`);
                    break;
                  }
                }

                if (hasRetryButton) {
                  logs.push(`🔥 确认这是需要清除数据的错误页面`);
                  return true;
                }
              }
            }

            // 也检查用户提供的具体DOM结构
            const specificErrorElements = document.querySelectorAll(
              'span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3',
            );
            for (const el of Array.from(specificErrorElements)) {
              const text = el.textContent?.trim();
              if (text && text.includes('出错了')) {
                logs.push(`🚨 通过CSS选择器检测到错误页面: "${text}"`);
                return true;
              }
            }

            return false;
          };

          // 检查是否为需要清除数据的错误页面
          const isSpecificErrorPage = checkForSpecificError();

          if (isSpecificErrorPage) {
            logs.push('❌ 检测到特定错误页面，需要清除站点数据');
            return {
              result: -1,
              logs: logs,
              isSpecificError: true, // 标记这是特定的错误页面
              timestamp: Date.now(),
              elementsFound: 0,
            };
          }

          // 检查页面是否可能出现其他错误（但不清除数据）
          const errorElements = document.querySelectorAll('[data-testid="error"]');
          if (errorElements.length > 0) {
            logs.push(`⚠️ 页面包含一般错误元素: ${errorElements.length} 个（不触发数据清除）`);
          }

          // 检查是否为私人账户
          const privateAccountElements = document.querySelectorAll('[data-testid="privateAccountPrompt"]');
          if (privateAccountElements.length > 0) {
            logs.push(`⚠️ 检测到私人账户提示（不触发数据清除）`);
          }

          // 统计页面上所有包含数字的元素
          const allElementsWithNumbers = Array.from(document.querySelectorAll('*')).filter(el => {
            const text = el.textContent?.trim();
            return text && /\d/.test(text) && text.length < 50;
          });
          logs.push(`页面上包含数字的元素总数: ${allElementsWithNumbers.length}`);

          // 记录页面上所有可能相关的文本
          const followingRelatedTexts: string[] = [];
          allElementsWithNumbers.forEach(el => {
            const text = el.textContent?.trim();
            if (
              text &&
              (text.toLowerCase().includes('following') || /\d+[,\.]?\d*\s*(K|M|B)?\s*following/i.test(text))
            ) {
              followingRelatedTexts.push(text);
            }
          });
          logs.push(`找到包含following的文本: [${followingRelatedTexts.join(', ')}]`);

          // 增强的提取逻辑，使用更多选择器
          const selectors = [
            // Twitter官方选择器
            '[data-testid="UserFollowing-Count"]',
            'a[href$="/following"] span',
            'a[href*="/following"] span',
            // 通用following相关选择器
            'a[href*="following"] *',
            '[data-testid*="Following"] *',
            '[aria-label*="following" i] *',
            '[aria-label*="Following" i] *',
            // 更广泛的搜索
            'span:contains("following")',
            'div:contains("following")',
            'span[dir="ltr"]',
            'div[dir="ltr"]',
          ];

          let result = -1;
          let foundElements = 0;

          for (const selector of selectors) {
            logs.push(`尝试选择器: ${selector}`);
            const elements = Array.from(document.querySelectorAll(selector));
            foundElements += elements.length;

            logs.push(`找到 ${elements.length} 个元素匹配 ${selector}`);

            for (const el of elements) {
              const text = el.textContent?.trim();
              logs.push(`元素内容: "${text}"`);

              if (text) {
                // 尝试从文本中提取数字，正确处理带逗号的数字格式
                logs.push(`正在解析文本: "${text}"`);

                // 验证文本是否可能包含年份等错误数据
                if (text.match(/20[2-3]\d/) && text.length < 10) {
                  logs.push(`跳过可能的年份文本: "${text}"`);
                  continue;
                }

                // 移除逗号和空格，但先检查原始文本中是否有逗号分隔的数字
                const originalCommaMatch = text.match(/\d{1,3}(?:,\d{3})+/);
                if (originalCommaMatch) {
                  // 如果找到了逗号分隔的数字，直接处理
                  const numStr = originalCommaMatch[0].replace(/,/g, '');
                  const num = parseInt(numStr, 10);
                  if (!isNaN(num) && num >= 0) {
                    // 添加年份检查
                    if (num >= 2020 && num <= 2030) {
                      logs.push(`跳过可能的年份数字: ${num}`);
                      continue;
                    }
                    logs.push(`从带逗号文本解析出数字: ${num}`);
                    result = num;
                    break;
                  }
                }

                // 移除逗号和空格
                const cleanText = text.replace(/[,\s]/g, '');

                // 验证文本是否可能包含年份等错误数据
                if (text.match(/20[2-3]\d/) && text.length < 10) {
                  logs.push(`跳过可能的年份文本: "${text}"`);
                  continue;
                }

                // 尝试提取数字 + 单位的模式
                const extractNumberWithUnit = (txt: string): number | null => {
                  // 匹配数字+单位，或者数字+关注相关文本
                  const match =
                    txt.match(/(\d+(?:\.\d+)?)(K|M|B|千|万|亿)?/i) ||
                    txt.match(/(\d+(?:\.\d+)?)(?=.*(?:following|Following|关注|正在关注))/i);

                  if (match) {
                    const number = parseFloat(match[1]);

                    // 检查是否是年份
                    if (number >= 2020 && number <= 2030 && !match[2]) {
                      logs.push(`跳过可能的年份: ${number}`);
                      return null;
                    }

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
                  logs.push(`从文本 "${text}" 中提取到数字: ${fullMatch}`);
                  result = fullMatch;
                  break;
                }

                // 如果完整匹配失败，尝试在文本中查找数字
                const numberMatches = cleanText.match(/\d+(?:\.\d+)?/g);
                if (numberMatches && numberMatches.length > 0) {
                  logs.push(`找到 ${numberMatches.length} 个数字: [${numberMatches.join(', ')}] 在文本: "${text}"`);
                  // 如果有多个数字，选择最可能是关注数的那个
                  for (const numStr of numberMatches) {
                    const num = parseFloat(numStr);
                    logs.push(`检查数字: ${num} (类型: ${typeof num})`);
                    // 关注数通常不会太小，且排除年份
                    if (num >= 5 && !(num >= 2020 && num <= 2030)) {
                      logs.push(`✅ 接受数字: ${num} (非年份且大于等于5)`);
                      result = Math.round(num);
                      break;
                    } else {
                      logs.push(`❌ 拒绝数字: ${num} (原因: ${num < 5 ? '太小' : '可能是年份'})`);
                    }
                  }
                  // 如果找到了有效数字，退出外层循环
                  if (result !== -1) break;
                }
              }
            }

            if (result !== -1) break;
          }

          // 如果常规选择器没有找到，尝试其他选择器
          if (result === -1) {
            logs.push('常规选择器未找到结果，尝试其他选择器...');

            const additionalSelectors = [
              'a[href*="following"] div',
              'a[href*="following"] span',
              'div:contains("following")',
              'span:contains("following")',
            ];

            for (const selector of additionalSelectors) {
              logs.push(`尝试额外选择器: ${selector}`);
              try {
                const elements = Array.from(document.querySelectorAll(selector));
                foundElements += elements.length;

                logs.push(`找到 ${elements.length} 个元素匹配 ${selector}`);

                for (const el of elements) {
                  const text = el.textContent?.trim();
                  logs.push(`元素内容: "${text}"`);

                  if (text && /following/i.test(text)) {
                    logs.push(`正在解析包含following的文本: "${text}"`);

                    // 移除逗号和空格，但先检查原始文本中是否有逗号分隔的数字
                    const originalCommaMatch = text.match(/\d{1,3}(?:,\d{3})+/);
                    if (originalCommaMatch) {
                      // 如果找到了逗号分隔的数字，直接处理
                      const numStr = originalCommaMatch[0].replace(/,/g, '');
                      const num = parseInt(numStr, 10);
                      if (!isNaN(num) && num >= 0) {
                        logs.push(`从带逗号文本解析出数字: ${num}`);
                        result = num;
                        break;
                      }
                    }

                    // 移除逗号和空格
                    const cleanText = text.replace(/[,\s]/g, '');

                    // 验证文本是否可能包含年份等错误数据
                    if (text.match(/20[2-3]\d/) && text.length < 10) {
                      logs.push(`跳过可能的年份文本: "${text}"`);
                      continue;
                    }

                    // 尝试提取数字 + 单位的模式
                    const extractNumberWithUnit = (txt: string): number | null => {
                      // 匹配数字+单位，或者数字+关注相关文本
                      const match =
                        txt.match(/(\d+(?:\.\d+)?)(K|M|B|千|万|亿)?/i) ||
                        txt.match(/(\d+(?:\.\d+)?)(?=.*(?:following|Following|关注|正在关注))/i);

                      if (match) {
                        const number = parseFloat(match[1]);

                        // 检查是否是年份
                        if (number >= 2020 && number <= 2030 && !match[2]) {
                          logs.push(`跳过可能的年份: ${number}`);
                          return null;
                        }

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
                      logs.push(`从文本 "${text}" 中提取到数字: ${fullMatch}`);
                      result = fullMatch;
                      break;
                    }

                    // 如果完整匹配失败，尝试在文本中查找数字
                    const numberMatches = cleanText.match(/\d+(?:\.\d+)?/g);
                    if (numberMatches && numberMatches.length > 0) {
                      // 如果有多个数字，选择最可能是关注数的那个
                      for (const numStr of numberMatches) {
                        const num = parseFloat(numStr);
                        // 关注数通常不会太小，且排除年份
                        if (num >= 5 && !(num >= 2020 && num <= 2030)) {
                          logs.push(`从文本 "${text}" 中提取到数字: ${num}`);
                          result = Math.round(num);
                          break;
                        }
                      }
                    }
                  }
                }

                if (result !== -1) break;
              } catch (err) {
                logs.push(`选择器 ${selector} 出错: ${err}`);
              }
            }
          }

          logs.push(`最终结果: ${result}`);
          return { result, logs, timestamp: Date.now(), elementsFound: foundElements };
        },
      });
      console.log('步骤4完成: 主要提取函数执行结果:', results);

      // 如果结果为空或无效，尝试使用备用方法
      if (
        !results ||
        !results[0] ||
        !results[0].result ||
        results[0].result.result === null ||
        results[0].result.result === undefined ||
        results[0].result.result === -1
      ) {
        console.log('步骤5: 主要提取方法失败，等待5秒后尝试备用方法...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: backupExtractFollowingCount,
        });
        console.log('步骤5完成: 备用方法执行结果:', results);

        // 检查备用方法是否检测到特定错误页面
        if (
          results &&
          results[0] &&
          typeof results[0].result === 'object' &&
          results[0].result &&
          'isSpecificError' in results[0].result
        ) {
          const backupResultData = results[0].result as { result: number; isSpecificError: boolean };
          if (backupResultData.isSpecificError) {
            console.log(`🚨 备用方法检测到特定错误页面，立即清除站点数据...`);
            try {
              await clearTwitterSiteData();
              console.log(`清除站点数据完成，用于用户: ${screenName}`);

              // 通知侧边栏清除站点数据的操作
              try {
                chrome.runtime.sendMessage({
                  action: 'siteDataCleared',
                  screenName: screenName,
                  timestamp: new Date().toLocaleString(),
                  reason: '备用方法检测到错误页面',
                });
              } catch (msgError) {
                console.warn('发送站点数据清除通知失败:', msgError);
              }
            } catch (clearError) {
              console.error(`清除站点数据失败:`, clearError);
            }

            return -1;
          }
        }

        // 如果备用方法也失败，再等待5秒尝试一次更激进的方法
        if (
          !results ||
          !results[0] ||
          results[0].result === null ||
          results[0].result === undefined ||
          results[0].result === -1 ||
          (typeof results[0].result === 'object' &&
            results[0].result &&
            'result' in results[0].result &&
            results[0].result.result === -1)
        ) {
          console.log('步骤6: 备用方法也失败，等待5秒后尝试最后一次...');
          await new Promise(resolve => setTimeout(resolve, 5000));

          // 最后一次尝试：重新执行主要方法
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // 更简单直接的方法
              const allText = document.body.textContent || '';
              console.log('最后尝试：全页面文本长度:', allText.length);

              // 查找所有包含following的数字
              const matches = allText.match(/(\d+(?:,\d{3})*|\d+(?:\.\d+)?[KMB]?)\s*following/gi);
              if (matches && matches.length > 0) {
                console.log('最后尝试找到matches:', matches);
                for (const match of matches) {
                  const numbers = match.match(/\d+(?:,\d{3})*/);
                  if (numbers) {
                    const num = parseInt(numbers[0].replace(/,/g, ''), 10);
                    if (!isNaN(num) && num >= 0 && num < 100000) {
                      console.log('最后尝试成功提取:', num);
                      return num;
                    }
                  }
                }
              }

              console.log('最后尝试也失败了');
              return -1;
            },
          });
          console.log('步骤6完成: 最后尝试执行结果:', results);
        }
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

    // 不再关闭标签页，保留它以便后续使用
    // 原来的关闭标签页代码被移除了

    if (results && results[0] && results[0].result !== null && results[0].result !== undefined) {
      let followingCount: number;
      let isSpecificError = false;

      // 检查返回值类型
      if (typeof results[0].result === 'object' && results[0].result && 'result' in results[0].result) {
        // 新的返回格式，包含logs等信息或者备用方法的结果格式
        if ('logs' in results[0].result) {
          // 主要方法的返回格式
          const resultData = results[0].result as {
            result: number;
            logs: string[];
            timestamp: number;
            elementsFound: number;
            isSpecificError?: boolean;
          };
          followingCount = resultData.result;
          isSpecificError = resultData.isSpecificError || false;
          console.log('提取过程日志:', resultData.logs);
          console.log('找到的元素数量:', resultData.elementsFound);
        } else {
          // 备用方法的返回格式
          const backupResultData = results[0].result as { result: number; isSpecificError: boolean };
          followingCount = backupResultData.result;
          isSpecificError = backupResultData.isSpecificError || false;
          console.log('备用方法检测结果:', backupResultData);
        }

        // 如果检测到特定错误页面，直接清除数据并返回
        if (isSpecificError) {
          console.log(`🚨 检测到特定错误页面，立即清除站点数据...`);
          try {
            await clearTwitterSiteData();
            console.log(`清除站点数据完成，用于用户: ${screenName}`);

            // 通知侧边栏清除站点数据的操作
            try {
              chrome.runtime.sendMessage({
                action: 'siteDataCleared',
                screenName: screenName,
                timestamp: new Date().toLocaleString(),
                reason: '检测到错误页面',
              });
            } catch (msgError) {
              console.warn('发送站点数据清除通知失败:', msgError);
            }
          } catch (clearError) {
            console.error(`清除站点数据失败:`, clearError);
          }

          return -1;
        }
      } else {
        // 旧的返回格式，直接是数字
        followingCount = results[0].result as number;
      }

      if (followingCount !== -1) {
        console.log(`成功获取 ${screenName} 的关注数: ${followingCount}`);

        // 添加数据合理性验证
        if (typeof followingCount !== 'number' || followingCount < 0 || followingCount > 100000) {
          console.warn(`⚠️ 提取的关注数异常: ${followingCount}，类型: ${typeof followingCount}`);

          // 增加重试计数
          retryAttempts.set(key, currentRetry + 1);

          if (currentRetry < 2) {
            console.log(`数据异常，准备重试获取 ${screenName} 的关注数... (第 ${currentRetry + 1} 次重试)`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
            return await getFollowingCountFromTwitter(screenName, operationId, false); // 重试时创建新标签页
          } else {
            console.log(`数据异常且已达到最大重试次数，但不清除站点数据（仅在特定错误页面时清除）`);
            retryAttempts.delete(key);
            return -1;
          }
        }

        // 检查是否是可疑的年份数据
        if (followingCount >= 2020 && followingCount <= 2030) {
          console.warn(`⚠️ 提取的关注数疑似年份数据: ${followingCount}`);

          // 增加重试计数
          retryAttempts.set(key, currentRetry + 1);

          if (currentRetry < 2) {
            console.log(`疑似年份数据，准备重试获取 ${screenName} 的关注数... (第 ${currentRetry + 1} 次重试)`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
            return await getFollowingCountFromTwitter(screenName, operationId, false); // 重试时创建新标签页
          } else {
            console.log(`疑似年份数据且已达到最大重试次数，但不清除站点数据（仅在特定错误页面时清除）`);
            retryAttempts.delete(key);
            return -1;
          }
        }

        retryAttempts.delete(key); // 成功时清除重试计数
        return followingCount;
      }
    }

    // 无法获取关注数据时，不再自动清除站点数据
    console.log(`无法获取关注数据，但不清除站点数据（仅在检测到特定错误页面时清除）`);
    throw new Error('无法获取关注数据');
  } catch (error) {
    console.error(`获取 ${screenName} 关注数时出错:`, error);

    // 出错时才关闭标签页，并从映射中移除
    try {
      if (tab && tab.id) {
        await chrome.tabs.remove(tab.id);
        console.log(`出错时关闭标签页 ${tab.id}`);
        // 从映射中移除
        for (const [opId, tabId] of tabsMap.entries()) {
          if (tabId === tab.id) {
            tabsMap.delete(opId);
            console.log(`从映射中移除操作 ${opId} 的标签页 ${tabId}`);
            break;
          }
        }
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
      return await getFollowingCountFromTwitter(screenName, operationId, false); // 重试时创建新标签页
    } else {
      console.log(`用户 ${screenName} 重试次数已用完，但不清除站点数据（仅在特定错误页面时清除）`);
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
const backupExtractFollowingCount = (): number | { result: number; isSpecificError: boolean } => {
  console.log('使用备用方法提取关注数...');

  try {
    // 检查页面状态
    console.log(`备用方法页面状态: ${document.readyState}, URL: ${window.location.href}`);

    // 优先检查是否存在特定的错误页面
    const checkForSpecificError = (): boolean => {
      // 检测用户提到的特定错误页面结构
      const errorTexts = [
        '出错了。请尝试重新加载。',
        '出错了。请尝试重新加载',
        'Something went wrong. Try reloading.',
        'Something went wrong. Try reloading',
      ];

      for (const errorText of errorTexts) {
        // 查找包含错误文本的元素
        const errorElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const text = el.textContent?.trim();
          return text && text.includes(errorText);
        });

        if (errorElements.length > 0) {
          console.log(`🚨 备用方法检测到特定错误页面，找到错误文本: "${errorText}"`);

          // 进一步验证是否确实是错误页面（检查是否有重试按钮）
          const retryButtons = document.querySelectorAll('button[role="button"]');
          let hasRetryButton = false;

          for (const button of Array.from(retryButtons)) {
            const buttonText = button.textContent?.trim();
            if (
              buttonText &&
              (buttonText.includes('重试') || buttonText.includes('retry') || buttonText.includes('Retry'))
            ) {
              hasRetryButton = true;
              console.log(`✅ 备用方法确认找到重试按钮: "${buttonText}"`);
              break;
            }
          }

          if (hasRetryButton) {
            console.log(`🔥 备用方法确认这是需要清除数据的错误页面`);
            return true;
          }
        }
      }

      // 也检查用户提供的具体DOM结构
      const specificErrorElements = document.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
      for (const el of Array.from(specificErrorElements)) {
        const text = el.textContent?.trim();
        if (text && text.includes('出错了')) {
          console.log(`🚨 备用方法通过CSS选择器检测到错误页面: "${text}"`);
          return true;
        }
      }

      return false;
    };

    // 检查是否为需要清除数据的错误页面
    const isSpecificErrorPage = checkForSpecificError();

    if (isSpecificErrorPage) {
      console.log('❌ 备用方法检测到特定错误页面，需要清除站点数据');
      return {
        result: -1,
        isSpecificError: true,
      };
    }

    // 检查是否为其他错误页面（但不清除数据）
    const errorElements = document.querySelectorAll('[data-testid="error"], .error, [class*="error"]');
    if (errorElements.length > 0) {
      console.log('⚠️ 检测到一般错误页面，无法提取关注数（不触发数据清除）');
      return -1;
    }

    // 检查是否为私人账户
    const privateElements = document.querySelectorAll('[data-testid="privateAccountPrompt"], [class*="private"]');
    if (privateElements.length > 0) {
      console.log('⚠️ 检测到私人账户，无法提取关注数（不触发数据清除）');
      return -1;
    }

    // 方法1: 遍历所有包含数字的元素
    const allElements = document.querySelectorAll('*');
    const potentialElements = Array.from(allElements).filter(el => {
      const text = el.textContent?.trim();
      return text && /\d/.test(text) && text.length < 30; // 增加长度限制
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

      // 添加过滤条件，排除明显的年份、日期、时间等
      if (isLikelyDateOrYear(text)) {
        console.log(`跳过可能的日期/年份文本: "${text}"`);
        continue;
      }

      const matches = text.match(/\d+/g);
      if (matches) {
        // 首先检查是否有带逗号的数字（如"5,311"）
        const commaNumberMatch = text.match(/\d{1,3}(?:,\d{3})+/);
        if (commaNumberMatch) {
          const numStr = commaNumberMatch[0].replace(/,/g, ''); // 移除逗号
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > 0 && !isLikelyWrongNumber(num)) {
            numberMatches.push(num);
          }
        } else {
          // 如果没有带逗号的数字，使用原来的逻辑
          matches.forEach(match => {
            const num = parseInt(match, 10);
            if (!isNaN(num) && num > 0 && !isLikelyWrongNumber(num)) {
              numberMatches.push(num);
            }
          });
        }
      }
    }

    console.log(`找到 ${numberMatches.length} 个有效数字: ${numberMatches.join(', ')}`);

    if (numberMatches.length > 0) {
      // 假设关注数通常在几十到几万之间，但排除明显的年份
      const likelyFollowingCounts = numberMatches.filter(n => n >= 10 && n <= 50000 && !isLikelyYear(n));
      if (likelyFollowingCounts.length > 0) {
        const result = likelyFollowingCounts[0];
        console.log(`备用方法2选择可能的关注数: ${result}`);
        return result;
      }

      // 如果没有符合范围的数字，检查是否有非年份的数字
      const nonYearNumbers = numberMatches.filter(n => !isLikelyYear(n));
      if (nonYearNumbers.length > 0) {
        console.log(`备用方法2返回第一个非年份数字: ${nonYearNumbers[0]}`);
        return nonYearNumbers[0];
      }
    }

    // 方法3: 尝试使用更激进的选择器
    const aggressiveSelectors = [
      'a[href*="following"]',
      '[data-testid*="follow"]',
      '[aria-label*="follow" i]',
      'span[dir="ltr"]',
      'div[dir="ltr"]',
      'span',
      'div',
    ];

    for (const selector of aggressiveSelectors) {
      console.log(`尝试激进选择器: ${selector}`);
      const elements = Array.from(document.querySelectorAll(selector));

      for (const el of elements) {
        const text = el.textContent?.trim();
        if (!text || text.length > 50) continue;

        // 查找包含数字和following的文本
        if (text.toLowerCase().includes('following') || /\d+[,\.]?\d*\s*(K|M|B)?\s*following/i.test(text)) {
          console.log(`激进方法找到following相关文本: "${text}"`);
          const count = parseFollowingCount(text);
          if (count !== null && count >= 0 && !isLikelyYear(count)) {
            console.log(`激进方法成功提取关注数: ${count}`);
            return count;
          }
        }
      }
    }

    // 方法4: 全页面文本扫描
    console.log('尝试全页面文本扫描...');
    const pageText = document.body.textContent || '';
    const followingMatches = pageText.match(/(\d+(?:,\d{3})*|\d+(?:\.\d+)?[KMB]?)\s*following/gi);
    if (followingMatches) {
      console.log(`全页面扫描找到: [${followingMatches.join(', ')}]`);
      for (const match of followingMatches) {
        const count = parseFollowingCount(match);
        if (count !== null && count >= 0 && !isLikelyYear(count)) {
          console.log(`全页面扫描成功提取关注数: ${count}`);
          return count;
        }
      }
    }

    // 方法5: 尝试在页面源码中查找
    const pageSource = document.documentElement.outerHTML;
    const followingMatch =
      pageSource.match(/following_count\D*(\d+)/i) ||
      pageSource.match(/followingCount\D*(\d+)/i) ||
      pageSource.match(/"following_count":(\d+)/i) ||
      pageSource.match(/"followingCount":(\d+)/i);

    if (followingMatch && followingMatch[1]) {
      const count = parseInt(followingMatch[1], 10);
      if (!isNaN(count) && count >= 0 && !isLikelyYear(count)) {
        console.log(`备用方法5从源码提取关注数: ${count}`);
        return count;
      }
    }

    console.log('所有备用方法都失败了');
    return -1;
  } catch (error) {
    console.error('备用提取方法出错:', error);
    return -1;
  }
};

// 新增：检查是否是可能的年份
const isLikelyYear = (num: number): boolean => {
  return num >= 2020 && num <= 2030; // 当前时间附近的年份
};

// 新增：检查是否是明显错误的数字
const isLikelyWrongNumber = (num: number): boolean => {
  // 排除年份、明显过大的数字等
  return isLikelyYear(num) || num > 100000;
};

// 新增：检查文本是否包含日期或年份
const isLikelyDateOrYear = (text: string): boolean => {
  // 检查是否包含明显的日期格式或年份
  return (
    /20[2-3]\d/.test(text) || // 2020-2039年份
    /\d{1,2}\/\d{1,2}\/\d{4}/.test(text) || // MM/DD/YYYY格式
    /\d{4}-\d{1,2}-\d{1,2}/.test(text) || // YYYY-MM-DD格式
    /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(text)
  ); // 英文月份
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

  // 验证文本是否可能包含年份等错误数据
  if (text.match(/20[2-3]\d/) && text.length < 10) {
    console.log(`跳过可能的年份文本: "${text}"`);
    return null;
  }

  // 移除逗号和空格，但先检查原始文本中是否有逗号分隔的数字
  const originalCommaMatch = text.match(/\d{1,3}(?:,\d{3})+/);
  if (originalCommaMatch) {
    // 如果找到了逗号分隔的数字，直接处理
    const numStr = originalCommaMatch[0].replace(/,/g, '');
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num >= 0 && !isLikelyYear(num)) {
      console.log(`从带逗号文本解析出数字: ${num}`);
      return num;
    }
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

      // 检查是否是年份
      if (number >= 2020 && number <= 2030 && !match[2]) {
        console.log(`跳过可能的年份: ${number}`);
        return null;
      }

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
      // 关注数通常不会太小，且排除年份
      if (num >= 5 && !isLikelyYear(num)) {
        return Math.round(num);
      }
    }
    // 如果没有找到合适的，且第一个数字不是年份，返回第一个数字
    const firstNum = Math.round(parseFloat(numberMatches[0]));
    if (!isLikelyYear(firstNum)) {
      return firstNum;
    }
  }

  return null;
};

// 清除 Twitter 站点数据的函数
const clearTwitterSiteData = async (): Promise<void> => {
  console.log('开始清除 Twitter 站点数据...');

  try {
    // 第二步：使用页面脚本直接清除IndexedDB和其他存储
    try {
      console.log('使用页面脚本直接清除存储数据...');

      // 创建一个临时标签页
      const tempTab = await chrome.tabs.create({
        url: 'https://x.com',
        active: false,
      });

      if (tempTab.id) {
        try {
          // 等待页面完全加载
          await new Promise(resolve => setTimeout(resolve, 5000));

          // 注入强力清除脚本
          const result = await chrome.scripting.executeScript({
            target: { tabId: tempTab.id },
            func: async () => {
              console.log('开始执行强力清除...');
              const results = [];

              try {
                // 1. 强制清除所有IndexedDB数据库
                if ('indexedDB' in window) {
                  console.log('清除IndexedDB...');

                  // 获取所有数据库
                  const databases = await indexedDB.databases();
                  console.log('发现数据库:', databases);
                  results.push(`发现 ${databases.length} 个数据库`);

                  // 强制删除每个数据库
                  for (const db of databases) {
                    if (db.name) {
                      try {
                        console.log(`强制删除数据库: ${db.name}`);

                        // 创建删除请求
                        const deleteRequest = indexedDB.deleteDatabase(db.name);

                        // 强制等待删除完成
                        await new Promise(resolve => {
                          const timeout = setTimeout(() => {
                            console.log(`数据库 ${db.name} 删除超时，强制继续`);
                            resolve(false);
                          }, 3000); // 3秒超时

                          deleteRequest.onsuccess = () => {
                            console.log(`数据库 ${db.name} 删除成功`);
                            clearTimeout(timeout);
                            resolve(true);
                          };

                          deleteRequest.onerror = event => {
                            console.error(`删除数据库 ${db.name} 失败:`, event);
                            clearTimeout(timeout);
                            resolve(false);
                          };

                          deleteRequest.onblocked = () => {
                            console.warn(`数据库 ${db.name} 删除被阻塞，尝试强制删除`);
                            // 不等待，直接继续
                            clearTimeout(timeout);
                            resolve(false);
                          };
                        });

                        results.push(`删除数据库: ${db.name}`);
                      } catch (dbError: any) {
                        console.error(`删除数据库 ${db.name} 异常:`, dbError);
                        results.push(`删除数据库 ${db.name} 失败: ${dbError.message}`);
                      }
                    }
                  }

                  // 验证删除结果
                  try {
                    const remainingDbs = await indexedDB.databases();
                    console.log('删除后剩余数据库:', remainingDbs);
                    results.push(`剩余数据库: ${remainingDbs.length} 个`);
                  } catch (checkError) {
                    console.warn('检查剩余数据库失败:', checkError);
                  }
                }

                // 2. 清除其他存储
                try {
                  const beforeLocal = localStorage.length;
                  const beforeSession = sessionStorage.length;

                  localStorage.clear();
                  sessionStorage.clear();

                  results.push(`localStorage: ${beforeLocal} → 0`);
                  results.push(`sessionStorage: ${beforeSession} → 0`);
                  console.log('localStorage和sessionStorage已清除');
                } catch (storageError: any) {
                  console.error('清除localStorage/sessionStorage失败:', storageError);
                  results.push(`存储清除失败: ${storageError.message}`);
                }

                // 3. 清除所有缓存
                if ('caches' in window) {
                  try {
                    const cacheNames = await caches.keys();
                    console.log('发现缓存:', cacheNames);

                    let deletedCaches = 0;
                    for (const cacheName of cacheNames) {
                      try {
                        const deleted = await caches.delete(cacheName);
                        if (deleted) {
                          deletedCaches++;
                          console.log(`缓存 ${cacheName} 已删除`);
                        }
                      } catch (cacheError: any) {
                        console.error(`删除缓存 ${cacheName} 失败:`, cacheError);
                      }
                    }

                    results.push(`删除缓存: ${deletedCaches}/${cacheNames.length}`);
                  } catch (cacheError: any) {
                    console.error('清除缓存失败:', cacheError);
                    results.push(`缓存清除失败: ${cacheError.message}`);
                  }
                }

                // 4. 尝试清除Service Workers
                if ('navigator' in window && 'serviceWorker' in navigator) {
                  try {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const registration of registrations) {
                      await registration.unregister();
                    }
                    results.push(`Service Workers: ${registrations.length} 个已注销`);
                  } catch (swError) {
                    console.error('清除Service Workers失败:', swError);
                  }
                }

                // 5. 强力清除所有Cookie
                try {
                  console.log('开始强力清除Cookie...');
                  let cookieCount = 0;

                  // 获取当前域名的所有Cookie
                  const currentCookies = document.cookie.split(';');
                  cookieCount = currentCookies.filter(cookie => cookie.trim()).length;
                  console.log(`发现 ${cookieCount} 个Cookie:`, currentCookies);

                  // 方法1: 通过document.cookie清除
                  const cookiesToClear = document.cookie.split(';');
                  let clearedCookies = 0;

                  for (const cookie of cookiesToClear) {
                    const eqPos = cookie.indexOf('=');
                    const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
                    if (name) {
                      // 清除不同路径和域名的cookie
                      const clearPaths = ['/', '/home', '/i', '/messages', '/explore', '/notifications'];
                      const clearDomains = ['', '.x.com', '.twitter.com', '.twimg.com', '.t.co'];

                      for (const path of clearPaths) {
                        for (const domain of clearDomains) {
                          try {
                            // 设置过期时间为过去的时间来删除cookie
                            const expireDate = 'Thu, 01 Jan 1970 00:00:00 GMT';
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}`;
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}; secure`;
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}; httponly`;
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}; secure; httponly`;
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}; samesite=strict`;
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}; samesite=lax`;
                            document.cookie = `${name}=; expires=${expireDate}; path=${path}${domain ? `; domain=${domain}` : ''}; samesite=none; secure`;
                          } catch (cookieError) {
                            // 忽略单个cookie清除失败
                          }
                        }
                      }
                      clearedCookies++;
                    }
                  }

                  // 额外尝试：通过设置max-age来清除
                  const cookiesAgain = document.cookie.split(';');
                  for (const cookie of cookiesAgain) {
                    const eqPos = cookie.indexOf('=');
                    const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
                    if (name) {
                      try {
                        // 使用max-age=0来删除cookie
                        document.cookie = `${name}=; max-age=0; path=/`;
                        document.cookie = `${name}=; max-age=0; path=/; domain=.x.com`;
                        document.cookie = `${name}=; max-age=0; path=/; domain=.twitter.com`;
                        document.cookie = `${name}=; max-age=0; path=/; domain=.twimg.com`;
                        document.cookie = `${name}=; max-age=0; path=/; domain=.t.co`;
                      } catch (maxAgeError) {
                        // 忽略错误
                      }
                    }
                  }

                  // 最后的暴力方法：尝试清除可能的常见Twitter cookie名称
                  const commonTwitterCookies = [
                    'auth_token',
                    'guest_id',
                    'personalization_id',
                    'ct0',
                    '_twitter_sess',
                    'guest_id_ads',
                    'guest_id_marketing',
                    'kdt',
                    'remember_checked_on',
                    'twid',
                    'external_referer',
                    'des_opt_in',
                    'rweb_optin',
                  ];

                  for (const cookieName of commonTwitterCookies) {
                    try {
                      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
                      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.x.com`;
                      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.twitter.com`;
                      document.cookie = `${cookieName}=; max-age=0; path=/`;
                      document.cookie = `${cookieName}=; max-age=0; path=/; domain=.x.com`;
                      document.cookie = `${cookieName}=; max-age=0; path=/; domain=.twitter.com`;
                    } catch (commonCookieError) {
                      // 忽略错误
                    }
                  }

                  // 验证清除结果
                  const remainingCookies = document.cookie.split(';').filter(cookie => cookie.trim()).length;
                  results.push(`Cookie清除: ${cookieCount} → ${remainingCookies} (清除了 ${clearedCookies} 个)`);
                  console.log('Cookie清除完成，剩余Cookie:', document.cookie);
                } catch (cookieError: any) {
                  console.error('清除Cookie失败:', cookieError);
                  results.push(`Cookie清除失败: ${cookieError.message}`);
                }

                console.log('页面级强力清除完成:', results);
                return {
                  success: true,
                  results: results,
                  message: '强力清除完成',
                };
              } catch (error: any) {
                console.error('强力清除过程中出错:', error);
                return {
                  success: false,
                  error: error.message,
                  results: results,
                };
              }
            },
          });

          console.log('页面脚本执行结果:', result);
        } catch (scriptError) {
          console.error('页面脚本执行失败:', scriptError);
        } finally {
          // 关闭临时标签页
          try {
            await chrome.tabs.remove(tempTab.id);
            console.log('临时标签页已关闭');
          } catch (removeError) {
            console.warn('关闭临时标签页失败:', removeError);
          }
        }
      }
    } catch (error) {
      console.warn('页面脚本清除方法失败:', error);
    }

    console.log('Twitter 站点数据清除完成！');

    // 第三步：使用Chrome官方API清除浏览数据
    try {
      console.log('使用Chrome官方API清除浏览数据...');

      const origins = [
        'https://twitter.com',
        'https://x.com',
        'https://www.twitter.com',
        'https://www.x.com',
        'https://mobile.twitter.com',
        'https://m.twitter.com',
        'https://api.twitter.com',
        'https://api.x.com',
        'https://abs.twimg.com',
        'https://pbs.twimg.com',
        'https://video.twimg.com',
        'https://t.co',
        'https://tweetdeck.twitter.com',
        'https://analytics.twitter.com',
        'https://ads.twitter.com',
        'https://business.twitter.com',
        'https://help.twitter.com',
      ];

      console.log('第一次清除：针对特定域名的所有数据...');
      // 清除支持origin过滤的数据类型
      await chrome.browsingData.remove(
        {
          origins: origins,
          since: 0, // 从开始时间清除所有数据
        },
        {
          cache: true,
          cacheStorage: true,
          cookies: true,
          fileSystems: true,
          indexedDB: true,
          localStorage: true,
          serviceWorkers: true,
          webSQL: true,
        },
      );

      console.log('第二次清除：强力清除所有Twitter相关的cookies...');
      // 额外的强力cookie清除：使用cookies API直接删除
      try {
        // 获取所有Twitter相关的cookies并删除
        const allCookies = await chrome.cookies.getAll({});
        let deletedCookieCount = 0;

        for (const cookie of allCookies) {
          const domain = cookie.domain.toLowerCase();
          const name = cookie.name.toLowerCase();

          // 检查是否是Twitter相关的cookie
          if (
            domain.includes('twitter.com') ||
            domain.includes('x.com') ||
            domain.includes('twimg.com') ||
            domain.includes('t.co') ||
            name.includes('twitter') ||
            name.includes('auth_token') ||
            name.includes('guest_id') ||
            name.includes('personalization_id') ||
            name.includes('ct0') ||
            name.includes('_twitter_sess')
          ) {
            try {
              const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
              await chrome.cookies.remove({
                url: url,
                name: cookie.name,
                storeId: cookie.storeId,
              });
              deletedCookieCount++;
              console.log(`删除Cookie: ${cookie.name} from ${cookie.domain}`);
            } catch (cookieError) {
              console.warn(`删除Cookie失败: ${cookie.name}`, cookieError);
            }
          }
        }

        console.log(`通过Cookies API删除了 ${deletedCookieCount} 个相关Cookie`);
      } catch (cookiesApiError) {
        console.warn('通过Cookies API清除失败:', cookiesApiError);
      }

      console.log('第三次清除：清除最近时间段的相关数据...');
      // 清除不支持origin过滤的数据类型（按时间范围）
      await chrome.browsingData.remove(
        {
          since: Date.now() - 30 * 24 * 60 * 60 * 1000, // 最近30天
        },
        {
          appcache: true,
          formData: true,
          cookies: true, // 再次清除cookies以确保彻底
        },
      );

      console.log('第四次清除：全局强力清除（谨慎使用）...');
      // 最后的强力清除：清除所有cookies（可选，比较激进）
      try {
        await chrome.browsingData.remove(
          {
            since: 0,
          },
          {
            cookies: true,
          },
        );
        console.log('全局Cookie清除完成');
      } catch (globalClearError) {
        console.warn('全局Cookie清除失败:', globalClearError);
      }

      console.log('Chrome官方API清除完成');
    } catch (error) {
      console.warn('Chrome官方API清除失败:', error);
    }

    // 第四步：强制重新加载所有Twitter页面
    try {
      console.log('强制重新加载所有Twitter页面...');

      const tabs = await chrome.tabs.query({
        url: ['*://twitter.com/*', '*://x.com/*', '*://www.twitter.com/*', '*://www.x.com/*'],
      });

      for (const tab of tabs) {
        if (tab.id) {
          try {
            await chrome.tabs.reload(tab.id, { bypassCache: true });
            console.log(`已强制刷新标签页: ${tab.url}`);
          } catch (reloadError) {
            console.warn(`刷新标签页失败:`, reloadError);
          }
        }
      }
    } catch (error) {
      console.warn('重新加载页面失败:', error);
    }

    // 等待所有操作完成
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error: any) {
    console.error('清除 Twitter 站点数据时出错:', error);
    throw error;
  }
};

console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.ts' and save to reload.");
