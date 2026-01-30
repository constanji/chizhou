const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const { User, Conversation, Message } = require('@aipyq/data-schemas').createModels(mongoose);
const connect = require('./connect');

(async () => {
  await connect();

  /**
   * Show the welcome / help menu
   */
  console.purple('-----------------------------');
  console.purple('显示所有用户的统计信息');
  console.purple('-----------------------------');

  let users = await User.find({});
  let userData = [];
  for (const user of users) {
    let conversationsCount = (await Conversation.countDocuments({ user: user._id })) ?? 0;
    let messagesCount = (await Message.countDocuments({ user: user._id })) ?? 0;

    userData.push({
      用户: user.name,
      邮箱: user.email,
      对话数: conversationsCount,
      消息数: messagesCount,
    });
  }

  userData.sort((a, b) => {
    if (a.对话数 !== b.对话数) {
      return b.对话数 - a.对话数;
    }

    return b.消息数 - a.消息数;
  });

  console.table(userData);

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('发生未捕获的错误:');
    console.error(err);
  }

  if (!err.message.includes('fetch failed')) {
    process.exit(1);
  }
});
