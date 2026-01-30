const { logger } = require('@aipyq/data-schemas');
const { getEndpointsConfig } = require('~/server/services/Config');

async function endpointController(req, res) {
  try {
    const endpointsConfig = await getEndpointsConfig(req);
    res.setHeader('Content-Type', 'application/json');
    res.json(endpointsConfig);
  } catch (error) {
    logger.error('Error in endpointController:', error);
    res.status(500).json({ error: 'Failed to fetch endpoints configuration' });
  }
}

module.exports = endpointController;
