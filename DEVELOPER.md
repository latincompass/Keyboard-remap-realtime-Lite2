# 键盘改键软件 - 程序员说明书

## 1. 软件概述

本软件是一个基于WebHID API的键盘改键工具，支持RAMA M6-B和其他6键键盘的键值修改、灯光控制和EEPROM查看。软件使用纯HTML、CSS和JavaScript实现，无需依赖任何外部库。

### 1.1 支持的设备

- **RAMA WORKS M6-B** (VID: 0x5241, PID: 0x006B)
- **新键盘 (6键)** (VID: 0x7c88, PID: 0x7c97)

### 1.2 主要功能

- 键值修改（支持基础键位、功能键、媒体键、换层键等）
- 灯光控制（基础灯光控制和高级灯光设置）
- EEPROM查看器（按层显示EEPROM内容）
- 设备选择
- 主题切换
- HTML备份

## 2. 系统架构

### 2.1 文件结构

```
├── index.html          # 主应用文件（包含HTML、CSS和JavaScript）
├── start_server.bat    # 启动本地服务器脚本
└── 参考文件/           # 参考资料
    ├── QMK文件/        # QMK相关文件
    ├── app-main/       # VIA源代码
    └── rama_works_m6_b/ # M6-B固件源代码
```

### 2.2 核心模块

1. **设备管理**：处理设备连接、断开和选择
2. **键值管理**：读取和写入键值
3. **灯光控制**：控制键盘灯光效果和设置
4. **EEPROM管理**：读取和显示EEPROM内容
5. **UI管理**：处理用户界面交互

## 3. VIA协议实现

### 3.1 协议命令

```javascript
const VIA_COMMAND = {
    GET_PROTOCOL: 0x01,
    GET_KEYBOARD_VALUE: 0x02,
    SET_KEYBOARD_VALUE: 0x03,
    GET_KEYCODE: 0x04,
    SET_KEYCODE: 0x05,
    CUSTOM_MENU_SET_VALUE: 0x07,      // 用于RGB背光控制
    CUSTOM_MENU_GET_VALUE: 0x08,      // 用于RGB背光控制
    CUSTOM_MENU_SAVE: 0x09,           // 用于RGB背光控制
    BACKLIGHT_CONFIG_SET_VALUE: 0x07,  // 旧命令，保留以兼容
    BACKLIGHT_CONFIG_GET_VALUE: 0x08,  // 旧命令，保留以兼容
    BACKLIGHT_CONFIG_SAVE: 0x09        // 旧命令，保留以兼容
};
```

### 3.2 命令发送实现

```javascript
async function sendVIAReport(commandId, dataArray) {
    if (!hidDevice) return;
    const reportData = new Uint8Array(32); // WebHID使用32字节
    reportData[0] = commandId; // 第1字节：VIA命令ID
    
    // 严格填充数据（防止越界）
    if (dataArray && dataArray.length) {
        dataArray.forEach((val, idx) => {
            if (idx + 1 < 32) {
                reportData[idx + 1] = val & 0xFF; // 确保是8位
            }
        });
    }
    
    // 强制使用reportId=0（VIA/raw_hid标准）
    try {
        await hidDevice.sendReport(0, reportData);
        console.log(`[DEBUG] Sent command ${commandId} (0x${commandId.toString(16)}) with data:`, dataArray || []);
    } catch (e) {
        showStatus(`发送指令失败: ${e.message}`, 3000);
        console.error(`[ERROR] Send command ${commandId} error:`, e);
    }
}
```

### 3.3 键值读取和写入

#### 3.3.1 读取键值

```javascript
async function readKey(keyIndex, layer = CURRENT_LAYER) {
    if (!hidDevice) return 0;

    try {
        // 发送读取指令：[0x04, 层, 行, 列]
        await sendVIAReport(VIA_COMMAND.GET_KEYCODE, [layer, 0, keyIndex]);
        
        // 等待响应（5秒超时）
        const keyCode = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('读取超时')), 5000);
            const onInput = (e) => {
                if (e.reportId === 0) {
                    clearTimeout(timeout);
                    hidDevice.removeEventListener('inputreport', onInput);
                    const data = new Uint8Array(e.data.buffer);
                    
                    // 健壮性处理：检查数据长度
                    if (data.length >= 6) {
                        // 标准VIA协议：高8位在前，低8位在后
                        const code = (data[4] << 8) | data[5];
                        resolve(code);
                    } else if (data.length >= 5) {
                        // 兼容模式：只使用低8位
                        const code = data[4];
                        resolve(code);
                    } else {
                        resolve(0); // 返回0表示错误
                    }
                }
            };
            hidDevice.addEventListener('inputreport', onInput);
        });
        return keyCode;

    } catch (error) {
        console.error(`[ERROR] Read key ${keyIndex} error:`, error);
        showStatus(`读取按键${keyIndex+1}失败: ${error.message}`, 3000);
        return 0;
    }
}
```

#### 3.3.2 写入键值

```javascript
async function writeKey(keyIndex, keyCode) {
    if (!hidDevice) {
        showStatus('请先连接设备', 2000);
        return;
    }

    try {
        // 严格拆分16位键值为高低字节（必须！）
        const keycodeH = (keyCode >> 8) & 0xFF; // 高8位
        const keycodeL = keyCode & 0xFF;        // 低8位
        
        // 发送写入指令：[0x05, 层, 行, 列, 高字节, 低字节]
        await sendVIACommand(VIA_COMMAND.SET_KEYCODE, [
            CURRENT_LAYER, 0, keyIndex, keycodeH, keycodeL
        ]);
        
        // 立即更新显示
        const displayText = keyCodeToText[keyCode] || `0x${keyCode.toString(16).padStart(4, '0')}`;
        m6bKeys[keyIndex].textContent = displayText;
        showStatus(`已将按键 [${keyIndex+1}] 设置为 ${displayText}`, 2000);

    } catch (error) {
        showStatus(`写入按键失败: ${error.message}`, 3000);
        console.error('写入键值错误:', error);
    }
}
```

## 4. EEPROM操作

### 4.1 EEPROM读取

```javascript
async function readEEPROM(layer = 0) {
    if (!hidDevice) {
        showStatus('请先连接设备', 3000);
        return;
    }
    
    try {
        showStatus(`正在读取第${layer}层EEPROM...`, 2000);
        
        // 读取EEPROM内容（使用VIA协议的GET_KEYBOARD_VALUE命令）
        const eepromData = [];
        
        // 读取键值数据（6个键位，每个键位2字节）
        for (let i = 0; i < 6; i++) {
            const keyCode = await readKey(i, layer);
            eepromData.push(keyCode & 0xFF); // 低8位 (与keycodes.h一致)
            eepromData.push((keyCode >> 8) & 0xFF); // 高8位 (与keycodes.h一致)
        }
        
        // 填充剩余数据
        for (let i = 12; i < 64; i++) {
            eepromData.push(0);
        }
        
        // 显示EEPROM内容
        displayEEPROM(eepromData, layer);
        showStatus(`第${layer}层EEPROM读取完成`, 2000);
    } catch (error) {
        showStatus(`读取EEPROM失败: ${error.message}`, 3000);
        console.error('读取EEPROM失败:', error);
    }
}
```

### 4.2 EEPROM显示

```javascript
function displayEEPROM(data, layer = 0) {
    const eepromGrid = document.getElementById('eepromGrid');
    eepromGrid.innerHTML = '';
    
    // 添加层信息标题
    const layerTitle = document.createElement('div');
    layerTitle.className = 'eeprom-layer-title';
    layerTitle.textContent = `第${layer}层键值数据`;
    eepromGrid.appendChild(layerTitle);
    
    for (let i = 0; i < data.length; i++) {
        const cell = document.createElement('div');
        cell.className = 'eeprom-cell' + (data[i] !== 0 ? ' has-data' : '');
        
        // 创建值显示元素
        const valueElement = document.createElement('div');
        valueElement.className = 'eeprom-value';
        valueElement.textContent = `0x${data[i].toString(16).padStart(4, '0')}`; // 显示为4位十六进制
        
        // 创建地址显示元素
        const addressElement = document.createElement('div');
        addressElement.className = 'eeprom-address';
        addressElement.textContent = `0x${i.toString(16).padStart(4, '0')}`; // 显示为4位十六进制
        
        // 将元素添加到单元格
        cell.appendChild(valueElement);
        cell.appendChild(addressElement);
        cell.title = `地址: 0x${i.toString(16).padStart(4, '0')}, 值: 0x${data[i].toString(16).padStart(4, '0')}`;
        eepromGrid.appendChild(cell);
    }
}
```

### 4.3 EEPROM保存

#### 4.3.1 保存为文本文件

```javascript
function saveEEPROMToFile() {
    const eepromGrid = document.getElementById('eepromGrid');
    const cells = eepromGrid.querySelectorAll('.eeprom-cell');
    
    if (cells.length === 0) {
        showStatus('请先读取EEPROM', 3000);
        return;
    }
    
    const eepromData = [];
    cells.forEach((cell, index) => {
        const value = parseInt(cell.textContent.split('\n')[0].replace('0x', ''), 16);
        eepromData.push(value);
    });
    
    // 创建数据字符串
    let dataString = 'EEPROM内容:\n';
    for (let i = 0; i < eepromData.length; i += 8) {
        const row = eepromData.slice(i, i + 8);
        const rowHex = row.map(val => val.toString(16).padStart(2, '0')).join(' ');
        dataString += `0x${i.toString(16).padStart(2, '0')}: ${rowHex}\n`;
    }
    
    // 添加键值分析
    dataString += '\n键值分析（与keycodes.h一致）:\n';
    for (let i = 0; i < 6; i++) {
        const keyCode = (eepromData[i * 2 + 1] << 8) | eepromData[i * 2]; // 低8位在前，高8位在后
        dataString += `键位 ${i}: 0x${keyCode.toString(16).padStart(4, '0')}\n`;
    }
    
    // 创建下载链接
    const blob = new Blob([dataString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eeprom_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('EEPROM已保存到文件', 2000);
}
```

#### 4.3.2 保存为JSON文件

```javascript
function saveEEPROMAsJSON() {
    const eepromGrid = document.getElementById('eepromGrid');
    const cells = eepromGrid.querySelectorAll('.eeprom-cell');
    
    if (cells.length === 0) {
        showStatus('请先读取EEPROM', 3000);
        return;
    }
    
    const eepromData = [];
    const displayData = [];
    cells.forEach((cell, index) => {
        const value = parseInt(cell.textContent.split('\n')[0].replace('0x', ''), 16);
        eepromData.push(value);
        
        // 生成与显示界面一致的格式
        displayData.push({
            address: `0x${index.toString(16).padStart(4, '0')}`,
            value: `0x${value.toString(16).padStart(4, '0')}`,
            raw: value
        });
    });
    
    // 分析键值数据
    const keyData = [];
    for (let i = 0; i < 6; i++) {
        const keyCode = (eepromData[i * 2 + 1] << 8) | eepromData[i * 2]; // 低8位在前，高8位在后
        keyData.push({
            position: i,
            keycode: keyCode,
            hex: `0x${keyCode.toString(16).padStart(4, '0')}`
        });
    }
    
    // 创建JSON数据
    const jsonData = {
        timestamp: new Date().toISOString(),
        device: currentDevice ? currentDevice.name : 'Unknown',
        eeprom: {
            raw: eepromData,
            display: displayData, // 与显示界面一致的格式
            keys: keyData
        }
    };
    
    // 创建下载链接
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eeprom_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('EEPROM已保存为JSON', 2000);
}
```

## 5. 灯光控制

### 5.1 基础灯光控制

#### 5.1.1 发送灯光命令

```javascript
async function sendLightingCommand(command) {
    if (!hidDevice) {
        showStatus('请先连接设备', 3000);
        return;
    }
    
    const commandMap = {
        'LM_ON': 0x7810,
        'LM_OFF': 0x7811,
        'LM_TOGG': 0x7812,
        'LM_NEXT': 0x7813,
        'LM_PREV': 0x7814,
        'LM_BRIU': 0x7815,
        'LM_BRID': 0x7816,
        'LM_SPDU': 0x7817,
        'LM_SPDD': 0x7818
    };
    
    const keyCode = commandMap[command];
    if (!keyCode) {
        showStatus('无效的灯光命令', 3000);
        return;
    }
    
    try {
        // 发送灯光控制命令
        await sendVIACommand(0x04, [CURRENT_LAYER, 0, 0, (keyCode >> 8) & 0xFF, keyCode & 0xFF]);
        showStatus(`已发送灯光命令: ${command}`, 2000);
    } catch (error) {
        showStatus(`发送灯光命令失败: ${error.message}`, 3000);
        console.error('发送灯光命令失败:', error);
    }
}
```

#### 5.1.2 发送灯光效果

```javascript
async function sendLightingEffect(effectIndex) {
    if (!hidDevice) {
        showStatus('请先连接设备', 3000);
        return;
    }
    
    try {
        // 发送效果切换命令
        for (let i = 0; i <= effectIndex; i++) {
            await sendVIACommand(0x04, [CURRENT_LAYER, 0, 0, 0x78, 0x13]); // LM_NEXT
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        showStatus(`已切换到灯光效果: ${effectIndex}`, 2000);
    } catch (error) {
        showStatus(`切换灯光效果失败: ${error.message}`, 3000);
        console.error('切换灯光效果失败:', error);
    }
}
```

### 5.2 高级灯光控制

#### 5.2.1 设置VIA灯光值

```javascript
async function setVIALightingValue(valueId, ...params) {
    try {
        // 对于M6-B，使用CUSTOM_MENU_SET_VALUE命令
        // 格式：[channel, command, ...params]
        // 通道0通常用于RGB背光
        await sendVIACommand(VIA_COMMAND.CUSTOM_MENU_SET_VALUE, [0, valueId, ...params]);
        console.log(`[DEBUG] Set lighting value: ${valueId}, params:`, params);
        // 添加延迟，确保键盘有足够的时间处理命令
        await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
        console.error('设置灯光值失败:', error);
        throw error;
    }
}
```

#### 5.2.2 保存VIA灯光设置

```javascript
async function saveVIALighting() {
    try {
        // 对于M6-B，使用CUSTOM_MENU_SAVE命令
        // 格式：[channel]
        // 通道0通常用于RGB背光
        await sendVIACommand(VIA_COMMAND.CUSTOM_MENU_SAVE, [0]);
        console.log('[DEBUG] VIA lighting settings saved');
        // 添加延迟，确保键盘有足够的时间处理保存命令
        await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
        console.error('保存灯光设置失败:', error);
        throw error;
    }
}
```

#### 5.2.3 保存高级灯光设置

```javascript
async function saveAdvancedLightingSettings() {
    if (!hidDevice) {
        showStatus('请先连接设备', 3000);
        return;
    }
    
    try {
        // 读取Caps Lock和层指示灯设置
        const capsLockEnabled = document.getElementById('capsLockIndicator').checked;
        const capsLockColor = document.getElementById('capsLockColor').value;
        const layer1Enabled = document.getElementById('layer1Indicator').checked;
        const layer1Color = document.getElementById('layer1Color').value;
        const layer2Enabled = document.getElementById('layer2Indicator').checked;
        const layer2Color = document.getElementById('layer2Color').value;
        const layer3Enabled = document.getElementById('layer3Indicator').checked;
        const layer3Color = document.getElementById('layer3Color').value;
        
        // 解析颜色
        function parseColor(color) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            // 转换为HSL的Hue和Saturation
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h = 0, s = 0;
            
            if (max !== min) {
                const d = max - min;
                s = d / max;
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }
            
            return {
                hue: Math.round(h * 255),
                sat: Math.round(s * 255)
            };
        }
        
        // 设置Caps Lock指示灯
        const capsColor = parseColor(capsLockColor);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_CAPS_LOCK_INDICATOR_COLOR, capsColor.hue, capsColor.sat);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_CAPS_LOCK_INDICATOR_ROW_COL, capsLockEnabled ? 254 : 255, 254);
        
        // 设置层1指示灯
        const layer1Col = parseColor(layer1Color);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_LAYER_1_INDICATOR_COLOR, layer1Col.hue, layer1Col.sat);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_LAYER_1_INDICATOR_ROW_COL, layer1Enabled ? 254 : 255, 254);
        
        // 设置层2指示灯
        const layer2Col = parseColor(layer2Color);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_LAYER_2_INDICATOR_COLOR, layer2Col.hue, layer2Col.sat);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_LAYER_2_INDICATOR_ROW_COL, layer2Enabled ? 254 : 255, 254);
        
        // 设置层3指示灯
        const layer3Col = parseColor(layer3Color);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_LAYER_3_INDICATOR_COLOR, layer3Col.hue, layer3Col.sat);
        await setVIALightingValue(LIGHTING_VALUE.BACKLIGHT_LAYER_3_INDICATOR_ROW_COL, layer3Enabled ? 254 : 255, 254);
        
        // 保存设置到EEPROM
        await saveVIALighting();
        
        showStatus('高级灯光设置已保存', 2000);
    } catch (error) {
        showStatus(`保存高级灯光设置失败: ${error.message}`, 3000);
        console.error('保存高级灯光设置失败:', error);
    }
}
```

## 6. 设备管理

### 6.1 设备连接

```javascript
async function connectDevice() {
    if (!checkWebHIDSupport()) return;

    try {
        // 支持所有已配置的设备
        const filters = SUPPORTED_DEVICES.map(device => ({
            vendorId: device.vid,
            productId: device.pid
        }));

        const devices = await navigator.hid.requestDevice({
            filters: filters
        });

        if (devices.length === 0) {
            showStatus('未选择设备', 3000);
            return;
        }

        // 智能选择设备：优先选择具有raw_hid接口的设备
        let selectedDeviceIndex = 0;
        let bestDeviceIndex = 0;
        let maxScore = 0;
        
        devices.forEach((d, idx) => {
            let score = 0;
            
            // 检查产品名称是否包含M6-B
            if (d.productName && d.productName.includes('M6-B')) {
                score += 10;
            }
            
            // 检查collections数量
            if (d.collections && d.collections.length === 1) {
                score += 5;
            } else if (d.collections && d.collections.length > 0) {
                score += 2;
            }
            
            // 检查是否有outputReportLength为32的接口（raw_hid标准）
            if (d.collections) {
                d.collections.forEach(collection => {
                    if (collection.usagePages) {
                        collection.usagePages.forEach(usagePage => {
                            if (usagePage.usages) {
                                usagePage.usages.forEach(usage => {
                                    if (usage.outputReports && usage.outputReports.length > 0) {
                                        usage.outputReports.forEach(report => {
                                            if (report.reportLength === 32) {
                                                score += 8;
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
            
            if (score > maxScore) {
                maxScore = score;
                bestDeviceIndex = idx;
            }
        });
        
        selectedDeviceIndex = bestDeviceIndex;

        // 识别用户选择的设备类型
        const selectedHidDevice = devices[selectedDeviceIndex];
        const matchedDevice = SUPPORTED_DEVICES.find(device => 
            device.vid === selectedHidDevice.vendorId && 
            device.pid === selectedHidDevice.productId
        );
        
        if (matchedDevice) {
            currentDevice = matchedDevice;
            KEY_COUNT = currentDevice.keyCount;
            
            // 更新设备选择器选中状态
            const deviceSelector = document.getElementById('deviceSelector');
            const deviceIndex = SUPPORTED_DEVICES.findIndex(d => 
                d.vid === matchedDevice.vid && d.pid === matchedDevice.pid
            );
            if (deviceIndex !== -1) {
                deviceSelector.value = deviceIndex;
            }
        } else {
            console.warn('[WARN] Device not found in SUPPORTED_DEVICES, using default');
            currentDevice = SUPPORTED_DEVICES[0];
            KEY_COUNT = currentDevice.keyCount;
        }

        hidDevice = selectedHidDevice;
        await hidDevice.open();
        showStatus(`已连接 ${currentDevice.name}`, 3000);

        // 设备断开处理
        hidDevice.addEventListener('disconnect', () => {
            hidDevice = null;
            stopHeartbeat();
            connectPrompt.style.display = 'block';
            m6bKeyboard.style.display = 'none';
            deviceSelector.disabled = false; // 保持设备选择器可用
            showStatus('设备已断开', 3000);
        });

        // 显示键盘预览 + 激活键值面板
        connectPrompt.style.display = 'none';
        m6bKeyboard.style.display = 'grid';
        deviceSelector.disabled = false; // 保持设备选择器可用
        keySelectPanel.classList.add('active');

        // 启动心跳机制保持连接
        startHeartbeat();
        
        // 验证VIA协议 + 读取所有键值
        await sendVIAReport(VIA_COMMAND.GET_PROTOCOL, []);
        await readAllKeys();

    } catch (error) {
        showStatus(`连接失败: ${error.message}`, 5000);
        console.error('HID 连接错误:', error);
    }
}
```

### 6.2 设备选择

```javascript
function initDeviceSelector() {
    const deviceSelector = document.getElementById('deviceSelector');
    
    // 清空现有选项
    deviceSelector.innerHTML = '';
    
    // 添加所有支持的设备
    SUPPORTED_DEVICES.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = device.name;
        deviceSelector.appendChild(option);
    });
    
    // 绑定设备选择事件
    deviceSelector.addEventListener('change', async (e) => {
        const selectedIndex = parseInt(e.target.value);
        const selectedDevice = SUPPORTED_DEVICES[selectedIndex];
        
        // 如果选择的是当前设备，不做处理
        if (selectedDevice.vid === currentDevice.vid && selectedDevice.pid === currentDevice.pid) {
            return;
        }
        
        // 如果当前已连接设备，先断开
        if (hidDevice) {
            try {
                await hidDevice.close();
            } catch (error) {
                console.warn('断开设备失败:', error);
            }
            hidDevice = null;
            stopHeartbeat();
            connectPrompt.style.display = 'block';
            m6bKeyboard.style.display = 'none';
        }
        
        // 更新当前设备
        currentDevice = selectedDevice;
        KEY_COUNT = currentDevice.keyCount;
        console.log(`[DEBUG] Selected device: ${currentDevice.name}, KEY_COUNT: ${KEY_COUNT}`);
        showStatus(`已选择 ${currentDevice.name}`, 2000);
    });
}
```

## 7. 心跳机制

为了保持WebHID连接活跃，软件实现了心跳机制：

```javascript
// 心跳机制 - 保持WebHID连接活跃
function startHeartbeat() {
    // 清除已有的心跳
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }
    
    // 每30秒发送一次读取请求保持连接
    heartbeatTimer = setInterval(async () => {
        if (hidDevice && hidDevice.opened) {
            try {
                // 发送一个简单的读取命令保持连接活跃
                await sendVIAReport(VIA_COMMAND.GET_PROTOCOL, []);
                console.log('[HEARTBEAT] Connection kept alive');
            } catch (error) {
                console.error('[HEARTBEAT] Error:', error);
            }
        }
    }, 30000); // 30秒心跳
}

// 停止心跳
function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        console.log('[HEARTBEAT] Stopped');
    }
}
```

## 8. UI管理

### 8.1 标签页切换

```javascript
function bindTabSwitch() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // 切换标签按钮状态
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 切换标签内容
            const tabId = btn.dataset.tab;
            tabContents.forEach(content => {
                content.style.display = 'none';
            });
            document.getElementById(`${tabId}Tab`).style.display = 'block';
            
            showStatus(`切换到 ${btn.textContent} 面板`, 1000);
        });
    });
}
```

### 8.2 层切换

```javascript
function bindLayerSwitch() {
    layerBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            layerBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const layer = parseInt(btn.dataset.layer);
            CURRENT_LAYER = layer;
            showStatus(`切换到第 ${layer} 层`, 1000);
            
            // 如果已连接设备，立即读取该层键值
            if (hidDevice && hidDevice.opened) {
                await readAllKeys();
            }
        });
    });
}
```

### 8.3 主题切换

```javascript
function bindThemeSwitch() {
    const themeBtns = document.querySelectorAll('.theme-btn');
    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            
            // 切换按钮激活状态
            themeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 应用主题到body
            document.body.dataset.theme = theme;
            
            // 保存到localStorage
            localStorage.setItem('m6b-theme', theme);
            
            showStatus(`已切换到${btn.title}`, 1500);
        });
    });
}
```

## 9. 错误处理

### 9.1 设备连接错误

```javascript
try {
    // 设备连接代码
} catch (error) {
    showStatus(`连接失败: ${error.message}`, 5000);
    console.error('HID 连接错误:', error);
}
```

### 9.2 命令发送错误

```javascript
try {
    await hidDevice.sendReport(0, reportData);
} catch (e) {
    showStatus(`发送指令失败: ${e.message}`, 3000);
    console.error(`[ERROR] Send command ${commandId} error:`, e);
}
```

### 9.3 键值读取错误

```javascript
try {
    // 键值读取代码
} catch (error) {
    console.error(`[ERROR] Read key ${keyIndex} error:`, error);
    showStatus(`读取按键${keyIndex+1}失败: ${error.message}`, 3000);
    return 0;
}
```

## 10. 性能优化

### 10.1 命令队列

虽然当前实现没有使用命令队列，但对于复杂操作，建议实现命令队列以避免命令冲突：

```javascript
// 命令队列实现示例
const commandQueue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || commandQueue.length === 0) return;
    
    isProcessing = true;
    const command = commandQueue.shift();
    
    try {
        await command();
    } catch (error) {
        console.error('Command error:', error);
    } finally {
        isProcessing = false;
        processQueue();
    }
}

function queueCommand(command) {
    commandQueue.push(command);
    processQueue();
}
```

### 10.2 防抖和节流

对于频繁触发的事件（如滑块拖动），建议使用防抖或节流：

```javascript
// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 应用防抖
const debouncedSave = debounce(saveLightingSettings, 500);
```

## 11. 扩展指南

### 11.1 添加新设备

要添加新设备，需要在`SUPPORTED_DEVICES`数组中添加设备信息：

```javascript
const SUPPORTED_DEVICES = [
    {
        name: 'RAMA WORKS M6-B',
        vid: 0x5241,
        pid: 0x006B,
        keyCount: 6
    },
    {
        name: '新键盘 (6键)',
        vid: 0x7c88,
        pid: 0x7c97,
        keyCount: 6
    },
    // 添加新设备
    {
        name: '新设备名称',
        vid: 0xXXXX,
        pid: 0xXXXX,
        keyCount: X
    }
];
```

### 11.2 添加新功能

要添加新功能，可以按照以下步骤：

1. 在HTML中添加UI元素
2. 在JavaScript中添加相应的事件监听器
3. 实现功能逻辑
4. 测试功能

## 12. 测试指南

### 12.1 功能测试

1. **设备连接测试**：测试不同设备的连接和断开
2. **键值修改测试**：测试修改键值并验证是否生效
3. **灯光控制测试**：测试基础灯光控制和高级灯光设置
4. **EEPROM查看测试**：测试按层查看EEPROM内容
5. **主题切换测试**：测试不同主题的切换
6. **备份功能测试**：测试HTML备份功能

### 12.2 兼容性测试

1. **浏览器兼容性**：测试在不同浏览器中的表现
2. **设备兼容性**：测试不同键盘设备的兼容性
3. **操作系统兼容性**：测试在不同操作系统中的表现

## 13. 故障排除

### 13.1 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|--------|
| 设备连接失败 | WebHID不支持或设备未授权 | 使用Chrome/Edge 89+浏览器，确保设备已授权 |
| 键值修改无效 | 命令格式错误或设备不响应 | 检查VIA协议命令格式，确保设备支持VIA |
| 灯光控制无效 | 命令格式错误或设备不支持 | 检查灯光控制命令，确保设备支持该功能 |
| EEPROM读取失败 | 命令格式错误或设备不响应 | 检查EEPROM读取命令，确保设备支持VIA |

### 13.2 调试技巧

1. **控制台日志**：使用`console.log`输出调试信息
2. **网络请求**：使用浏览器开发者工具查看WebHID请求
3. **错误处理**：确保所有操作都有错误处理
4. **状态提示**：使用`showStatus`函数显示操作状态

## 14. 总结

本软件是一个功能完整的键盘改键工具，支持键值修改、灯光控制和EEPROM查看。通过实现VIA协议，软件能够与支持VIA的键盘设备通信，实现各种功能。

软件的核心优势：

1. **纯前端实现**：无需后端服务，直接在浏览器中运行
2. **多设备支持**：支持多种6键键盘设备
3. **丰富的功能**：包括键值修改、灯光控制、EEPROM查看等
4. **用户友好**：直观的用户界面，支持主题切换
5. **可扩展性**：易于添加新设备和功能

通过本说明书，开发者可以快速了解软件的架构和实现细节，便于进行后续的维护和扩展。