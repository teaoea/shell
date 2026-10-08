/* Public text subscription; callback carries fixed outcome codes, never raw errors. */
function sfSubscriptionRefresh(source, complete) {
  if (!source || !sfSubscriptionURL(source)) return complete('subscription-invalid');
  try {
    $httpClient.get({ url: source, headers: { Accept: 'text/plain' }, timeout: 10000, 'auto-cookie': false, insecure: false }, function (error, response, body) {
      if (error || !response || Number(response.status || response.statusCode) !== 200 || typeof body !== 'string' || body.length > 256 * 1024) return complete('download-failed');
      var parsed = sfRuleParseList(body, true);
      if (parsed.invalid || parsed.rules.length > 100) return complete('format-invalid');
      try {
        var record = { source: source, rules: parsed.rules, updated_at: new Date().toISOString() };
        if ($persistentStore.write(JSON.stringify(record), 'search-filter.subscription.v1') !== true) return complete('storage-failed');
        return complete('updated', parsed.rules.length);
      } catch (_) { return complete('storage-failed'); }
    });
  } catch (_) { return complete('download-failed'); }
}
