// IMPORTANT: Lambda timeout must be set to at least 15 seconds to accommodate xAI API response times.
// AWS Console: Configuration > General configuration > Timeout
// CLI: aws lambda update-function-configuration --function-name MongoDBClientQueryHelper --timeout 15 --region us-west-2

const aws = require('aws-sdk');
const https = require('https');
const url = require('url');

let cachedApiKey = null;

exports.handler = async (event) => {
  try {
    // Log the full event
    console.debug('Event:', JSON.stringify(event, null, 2));

    // Retrieve API key from Secrets Manager if not cached
    if (!cachedApiKey) {
      const secretsManager = new aws.SecretsManager();
      const secret = await secretsManager.getSecretValue({ SecretId: 'prod/MongoDBClient/xAI' }).promise();
      cachedApiKey = JSON.parse(secret.SecretString).xAIApiKey;
    }

    // Extract request details from Lambda Function URL event
    const { requestContext = {}, rawPath = '/', rawQueryString = '', headers = {}, body } = event;
    const httpMethod = (requestContext.http?.method || 'GET');

    // Construct xAI API URL
    const apiUrl = `https://api.x.ai${rawPath}${rawQueryString ? '?' + rawQueryString : ''}`;
    console.debug('API URL:', apiUrl);

    // Parse URL for https request
    const parsedUrl = url.parse(apiUrl);

    // Filter out unwanted headers
    const { host, Host, ...cleanedHeaders } = headers;
    const requestHeaders = {
        ...cleanedHeaders,
        Authorization: `Bearer ${cachedApiKey}`,
        Host: 'api.x.ai',
        'Content-Type': headers['content-type'] || 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent': 'node',
        'Accept-Language': '*',
        'Sec-Fetch-Mode': 'cors'
    };

    // Set Content-Length if body exists
    if (body) {
        let bodyData = typeof body === 'string' ? body : JSON.stringify(body);
        requestHeaders['Content-Length'] = Buffer.byteLength(bodyData);
    }

    // Set up HTTPS request options
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: httpMethod,
      headers: requestHeaders,
    };
    // Create a redacted copy of options for logging
    const redactedOptions = {
      ...options,
      headers: {
        ...options.headers,
        Authorization: 'Bearer [REDACTED]' // Mask the API key
      }
    };
    console.debug('Request Method:', httpMethod);
    console.debug('Request URL:', JSON.stringify(parsedUrl, null, 2));
    console.debug('Request Options:', JSON.stringify(redactedOptions, null, 2));

    // Make HTTPS request
    return await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const resp = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          };

          // Log the full response (status, headers, body)
          console.debug('xAI API Response:', resp);

          resolve(resp);
        });
      });

      req.on('error', (error) => {
        console.error('Request Error:', error);
        reject(error);
      });

      // Write body if present
      if (body) {
        const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
        console.debug('Request Body:', bodyData);
        req.write(bodyData);
      }

      req.end();
    });
  } catch (error) {
    console.error('Proxy Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to proxy request', details: error.message })
    };
  }
};
