const {
  getEnvironment,
  isAuthorizedAutomationEvent,
  jsonResponse,
  logAutomationFailure,
  normalizeDate,
  runRpc
} = require('./lib/phase5-automation.js');

exports.config = {
  schedule: '15 0 * * *'
};

exports.handler = async function handler(event) {
  const env = getEnvironment();
  if (!env.ok) {
    return jsonResponse(500, { error: env.error });
  }

  if (!isAuthorizedAutomationEvent(event, env.value)) {
    return jsonResponse(403, { error: 'Automation request is not authorized.' });
  }

  const statDate = normalizeDate(new Date());

  try {
    const response = await runRpc(env.value, 'run_daily_statistics_automation', {
      stat_on: statDate
    });

    if (!response.ok) {
      throw new Error(response.body?.message || 'Daily statistics automation failed.');
    }

    return jsonResponse(200, {
      job: 'daily_statistics_generation',
      statDate,
      processed: Array.isArray(response.body) ? response.body.length : 0,
      results: response.body || []
    });
  } catch (error) {
    await logAutomationFailure(env.value, {
      jobName: 'daily_statistics_generation',
      error,
      context: { statDate }
    });

    return jsonResponse(500, { error: error.message || 'Daily statistics automation failed.' });
  }
};
