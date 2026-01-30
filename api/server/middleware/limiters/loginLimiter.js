const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@aipyq/api');
const { ViolationTypes } = require('@aipyq/data-provider');
const { removePorts } = require('~/server/utils');
const { logViolation } = require('~/cache');

// 登录限制配置
// LOGIN_WINDOW: 时间窗口（单位：分钟），在此时间窗口内计算登录尝试次数
// LOGIN_MAX: 最大登录尝试次数，超过此次数将被限制
// 例如：LOGIN_WINDOW=5, LOGIN_MAX=7 表示在5分钟内最多允许7次登录尝试
const { LOGIN_WINDOW = 5, LOGIN_MAX = 10, LOGIN_VIOLATION_SCORE: score } = process.env;
const windowMs = LOGIN_WINDOW * 60 * 1000;
const max = LOGIN_MAX;
const windowInMinutes = windowMs / 60000;
const message = `Too many login attempts, please try again after ${windowInMinutes} minutes.`;

const handler = async (req, res) => {
  const type = ViolationTypes.LOGINS;
  const errorMessage = {
    type,
    max,
    windowInMinutes,
  };

  await logViolation(req, res, type, errorMessage, score);
  return res.status(429).json({ message });
};

const limiterOptions = {
  windowMs,
  max,
  handler,
  keyGenerator: removePorts,
  store: limiterCache('login_limiter'),
};

const loginLimiter = rateLimit(limiterOptions);

module.exports = loginLimiter;
