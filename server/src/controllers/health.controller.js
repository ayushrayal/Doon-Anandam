export const getHealth = (req, res) => {
  res.status(200).json({
    success: true,
    service: 'Doon Anandam CRM API',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
};
