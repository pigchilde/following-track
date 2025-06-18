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

          // 检查页面是否可能出现错误
          const errorElements = document.querySelectorAll('[data-testid="error"]');
          if (errorElements.length > 0) {
            logs.push(`⚠️ 页面包含错误元素: ${errorElements.length} 个`);
          }

          // 检查是否为私人账户
          const privateAccountElements = document.querySelectorAll('[data-testid="privateAccountPrompt"]');
          if (privateAccountElements.length > 0) {
            logs.push(`⚠️ 检测到私人账户提示`);
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

        // 如果备用方法也失败，再等待5秒尝试一次更激进的方法
        if (
          !results ||
          !results[0] ||
          results[0].result === null ||
          results[0].result === undefined ||
          results[0].result === -1
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
            console.log(`数据异常且已达到最大重试次数，放弃获取 ${screenName} 的关注数`);
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
            console.log(`疑似年份数据且已达到最大重试次数，放弃获取 ${screenName} 的关注数`);
            retryAttempts.delete(key);
            return -1;
          }
        }

        retryAttempts.delete(key); // 成功时清除重试计数
        return followingCount;
      }
    }

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
    // 检查页面状态
    console.log(`备用方法页面状态: ${document.readyState}, URL: ${window.location.href}`);

    // 检查是否为错误页面
    const errorElements = document.querySelectorAll('[data-testid="error"], .error, [class*="error"]');
    if (errorElements.length > 0) {
      console.log('⚠️ 检测到错误页面，无法提取关注数');
      return -1;
    }

    // 检查是否为私人账户
    const privateElements = document.querySelectorAll('[data-testid="privateAccountPrompt"], [class*="private"]');
    if (privateElements.length > 0) {
      console.log('⚠️ 检测到私人账户，无法提取关注数');
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

console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.ts' and save to reload.");
