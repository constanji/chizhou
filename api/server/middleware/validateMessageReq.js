const { getConvo } = require('~/models');
const { getMessage } = require('~/models');

// Middleware to validate conversationId and user relationship
const validateMessageReq = async (req, res, next) => {
  let conversationId = req.params.conversationId || req.body.conversationId;

  if (conversationId === 'new') {
    return res.status(200).send([]);
  }

  if (!conversationId && req.body.message) {
    conversationId = req.body.message.conversationId;
  }

  const conversation = await getConvo(req.user.id, conversationId);

  // If conversation not found, check if it might be a messageId
  // This allows GET /api/messages/:messageId to work
  if (!conversation && req.method === 'GET' && req.params.conversationId) {
    const message = await getMessage({ user: req.user.id, messageId: conversationId });
    if (message) {
      // Store messageId in request for later use in route handler
      req.isMessageId = true;
      return next();
    }
    // For GET requests, allow proceeding even if conversation doesn't exist
    // This allows the route handler to return empty array for new conversations
    // that haven't been saved to the database yet
    req.conversationNotFound = true;
    return next();
  }

  if (!conversation) {
    // For non-GET requests, return 404 if conversation doesn't exist
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (conversation.user !== req.user.id) {
    return res.status(403).json({ error: 'User not authorized for this conversation' });
  }

  next();
};

module.exports = validateMessageReq;
