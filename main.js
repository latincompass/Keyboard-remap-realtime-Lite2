// 全局变量：存储已连接的键盘设备
let keyboardDevice = null;
// DOM 元素缓存
const connectBtn = document.getElementById('connectBtn');
const remapBtn = document.getElementById('remapBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const logText = document.getElementById('logText');

// 日志打印函数（封装，方便调试）
function log(message) {
  const time = new Date().toLocaleTimeString();
  logText.value += `[${time}] ${message}\n`;
  // 自动滚动到日志底部
  logText.scrollTop = logText.scrollHeight;
}
/**
 * 步骤 1：请求并连接键盘设备
 * 流程：1. 检测 WebHID 支持 → 2. 过滤设备 → 3. 申请权限 → 4. 打开设备连接
 */
async function connectKeyboard() {
  // 1. 检测浏览器是否支持 WebHID
  if (!navigator.hid) {
    log('错误：你的浏览器不支持 WebHID API，请使用 Chrome/Edge 89+！');
    return;
  }

  try {
    // 2. 定义设备过滤条件（关键：匹配你的键盘）
    // 方式1：指定键盘的 VID/PID（推荐，精准匹配）
    // 方式2：RawHID 通用过滤（兼容多数可编程键盘）
    // 方式3：空对象（兜底，显示所有 HID 设备让用户选）
    const filters = [
      { vendorId: 0x5241, productId: 0x006B }, // 示例：替换为你的键盘 VID/PID
      { usagePage: 0xFF60, usage: 0x61 },     // RawHID 通用过滤
      {}                                      // 兜底
    ];

    // 3. 调用 WebHID API 申请设备权限（浏览器会弹出设备选择框）
    log('正在请求设备权限，请在弹窗中选择你的键盘...');
    const devices = await navigator.hid.requestDevice({ filters });

    if (devices.length === 0) {
      log('用户未选择任何设备');
      return;
    }

    // 4. 获取选中的设备，并打开连接
    keyboardDevice = devices[0];
    if (!keyboardDevice.opened) {
      await keyboardDevice.open(); // 建立浏览器与键盘的通信通道
      log(`设备连接成功：${keyboardDevice.productName || '未知键盘'}`);
    }

    // 5. 绑定设备断开监听（设备意外断开时触发）
    keyboardDevice.addEventListener('disconnect', () => {
      log('警告：键盘设备已断开连接！');
      resetDeviceState(); // 重置状态
    });

    // 6. 监听键盘的响应（设备→浏览器的报文）
    listenKeyboardResponse(keyboardDevice);

    // 7. 启用按钮
    remapBtn.disabled = false;
    disconnectBtn.disabled = false;
    connectBtn.disabled = true;

  } catch (err) {
    log(`连接失败：${err.message}`);
    console.error('连接错误详情：', err);
  }
}

// 重置设备状态（断开后调用）
function resetDeviceState() {
  keyboardDevice = null;
  connectBtn.disabled = false;
  remapBtn.disabled = true;
  disconnectBtn.disabled = true;
}

// 绑定「连接设备」按钮点击事件
connectBtn.addEventListener('click', connectKeyboard);
/**
 * 步骤 2：监听键盘的响应报文
 * 作用：接收键盘返回的确认/状态信息，验证指令是否生效
 */
function listenKeyboardResponse(device) {
  device.addEventListener('receivereport', (event) => {
    const { reportId, data } = event;
    // 将 DataView 转为 Uint8Array（方便按字节解析）
    const responseBytes = new Uint8Array(data.buffer);
    // 打印响应日志（转为普通数组，易读）
    log(`键盘响应 [ReportID: ${reportId}]：${JSON.stringify(Array.from(responseBytes))}`);

    // 示例：解析 VIA 协议的“改键成功”响应（根据你的键盘协议调整）
    if (responseBytes[0] === 0x01 && responseBytes[1] === 0x00) {
      log('✅ 改键指令已被键盘确认生效！');
    }
  });
}
/**
 * 步骤 3：发送改键指令（VIA 协议示例）
 * 功能：将键盘 0 层的 A 键（索引 15）改为 B 键（USB 扫描码 0x05）
 * 注意：报文格式需匹配你的键盘固件协议（VIA/RawHID），以下是通用模板
 */
async function sendKeyRemapCommand() {
  if (!keyboardDevice || !keyboardDevice.opened) {
    log('错误：设备未连接或未打开！');
    return;
  }

  try {
    // 1. 核心参数（根据你的键盘调整）
    const reportId = 0; // 多数键盘为 0，部分设备需改（如 1/2）
    const reportLength = 64; // 键盘 HID 报告长度（通常 64 字节）
    
    // 2. 封装 VIA 改键报文（关键：协议格式）
    // VIA 协议基本格式（参考 QMK/VIA 文档）：
    // 字节0：指令类型（0x01 = 设置键位映射）
    // 字节1：键盘层号（0 = 默认层）
    // 字节2：键位索引（A 键通常对应索引 15，需查键盘布局表）
    // 字节3：目标扫描码（B 键 = 0x05，参考 USB HID 扫描码表）
    // 字节4~63：保留（填 0）
    const packet = new Uint8Array(reportLength);
    packet[0] = 0x01;        // 指令类型：设置键位
    packet[1] = 0x00;        // 层号：0
    packet[2] = 15;          // 键位索引：A 键
    packet[3] = 0x05;        // 目标扫描码：B 键
    // 其余字节默认 0，无需修改

    // 3. 发送报文到键盘
    log(`发送改键指令 [ReportID: ${reportId}]：${JSON.stringify(Array.from(packet))}`);
    await keyboardDevice.sendReport(reportId, packet);
    log('改键指令已发送，等待键盘确认...');

  } catch (err) {
    log(`指令发送失败：${err.message}`);
    console.error('发送错误详情：', err);
  }
}

// 绑定「发送改键指令」按钮点击事件
remapBtn.addEventListener('click', sendKeyRemapCommand);
/**
 * 步骤 4：断开设备连接
 */
async function disconnectKeyboard() {
  if (!keyboardDevice) {
    log('错误：无已连接的设备！');
    return;
  }

  try {
    if (keyboardDevice.opened) {
      await keyboardDevice.close(); // 关闭设备连接
      log(`设备已断开：${keyboardDevice.productName || '未知键盘'}`);
    }
    resetDeviceState(); // 重置状态
  } catch (err) {
    log(`断开失败：${err.message}`);
    console.error('断开错误详情：', err);
  }
}

// 绑定「断开设备」按钮点击事件
disconnectBtn.addEventListener('click', disconnectKeyboard);