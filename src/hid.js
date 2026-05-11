/**
 * src/hid.js - RAMA M6-B 专用（Output+Input Report 交互）
 */
export const logger = (msg, type = 'info') => {
  const validConsoleTypes = ['log', 'info', 'warn', 'error', 'debug'];
  const finalLogType = validConsoleTypes.includes(type) ? type : 'log';
  console[finalLogType](`[${new Date().toLocaleTimeString()}] ${msg}`);

  if (typeof document !== 'undefined') {
    const logEl = document.getElementById('log');
    if (logEl) {
      const className = type === 'success' ? 'success' 
                      : type === 'error' ? 'error' 
                      : 'info';
      logEl.innerHTML += `[${new Date().toLocaleTimeString()}] <span class="${className}">${msg}</span><br>`;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
};

/**
 * 连接M6-B（仅匹配0x5241/0x006b）
 */
export const connectRamaM6B = async () => {
  try {
    if (!('hid' in navigator)) {
      throw new Error('当前浏览器不支持WebHID，请使用Chrome/Edge 89+版本');
    }

    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: 0x5241, productId: 0x006b }]
    });

    if (devices.length === 0) {
      throw new Error('未找到M6-B设备（VID:0x5241, PID:0x006b），请检查设备连接');
    }

    const hidDevice = devices[0];
    logger(`检测到设备信息：
      → 设备名称：${hidDevice.productName || '未知'}
      → VID：0x${hidDevice.vendorId.toString(16).padStart(4, '0')}
      → PID：0x${hidDevice.productId.toString(16).padStart(4, '0')}`, 'info');

    if (!hidDevice.opened) {
      await hidDevice.open();
    }

    // 监听Input Report（设备主动上报/响应）
    hidDevice.addEventListener('inputreport', (event) => {
      const { data, reportId } = event;
      const rawData = new Uint8Array(data.buffer);
      logger(`📥 收到Input Report [ID:0x${reportId.toString(16)}]：${Array.from(rawData).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ')}`, 'info');
    });

    logger(`✅ 成功连接M6-B设备（已监听Input Report）`, 'success');
    return hidDevice;

  } catch (error) {
    logger(`❌ 连接失败：${error.message}`, 'error');
    throw error;
  }
};

/**
 * 发送Output Report（给M6-B发指令）
 * @param {HIDDevice} device - 已连接的M6-B
 * @param {number} reportId - Output Report ID（M6-B常用0x01/0x02）
 * @param {Uint8Array} data - 指令数据
 */
export const sendOutputReport = async (device, reportId = 0x01, data) => {
  if (!device || !device.opened) {
    throw new Error('设备未打开，请先连接');
  }

  // 补零到32字节（M6-B指令长度要求）
  const sendData = new Uint8Array(32);
  sendData.set(data.slice(0, 32));

  try {
    await device.sendReport(reportId, sendData);
    logger(`📤 发送Output Report [ID:0x${reportId.toString(16)}]：${Array.from(sendData).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ')}`, 'success');
    return true;
  } catch (error) {
    logger(`❌ 发送Output Report失败：${error.message}`, 'error');
    throw error;
  }
};

/**
 * M6-B 常用指令封装（读取设备信息）
 */
export const getM6BDeviceInfo = async (device) => {
  try {
    // 1. 发送「读取设备信息」指令（M6-B 通用指令：0x01 0x00 0x01 ...）
    await sendOutputReport(device, 0x01, new Uint8Array([0x01, 0x00, 0x01]));
    
    // 2. 等待100ms让设备响应（M6-B 响应延迟）
    await new Promise(resolve => setTimeout(resolve, 100));
    
    logger(`✅ 已发送读取设备信息指令，等待Input Report响应（可在日志查看）`, 'success');
  } catch (error) {
    logger(`❌ 读取M6-B信息失败：${error.message}`, 'error');
    throw error;
  }
};

/**
 * M6-B 读取当前层指令
 */
export const getM6BLayer = async (device) => {
  try {
    // M6-B 读取层号指令：0x02 0x01 0x00 ...
    await sendOutputReport(device, 0x01, new Uint8Array([0x02, 0x01, 0x00]));
    await new Promise(resolve => setTimeout(resolve, 100));
    logger(`✅ 已发送读取当前层指令，等待Input Report响应`, 'success');
  } catch (error) {
    logger(`❌ 读取M6-B层号失败：${error.message}`, 'error');
    throw error;
  }
};
