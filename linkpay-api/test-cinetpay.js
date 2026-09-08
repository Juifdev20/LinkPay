/**
 * Local test script for CinetPay SDK integration.
 * Run: node test-cinetpay.js
 *
 * Requires .env with:
 *   CINETPAY_API_KEY_CD=sk_test_...
 *   CINETPAY_API_PASSWORD_CD=...
 */
require('dotenv').config();
const { CinetPayClient } = require('cinetpay-js');

const COUNTRY = 'CD';

async function main() {
  const apiKey = process.env.CINETPAY_API_KEY_CD;
  const apiPassword = process.env.CINETPAY_API_PASSWORD_CD;

  if (!apiKey || !apiPassword) {
    console.error('Missing CINETPAY_API_KEY_CD or CINETPAY_API_PASSWORD_CD in .env');
    process.exit(1);
  }

  console.log('Creating CinetPay client...');
  const client = new CinetPayClient({
    credentials: {
      [COUNTRY]: { apiKey, apiPassword },
    },
    debug: true,
  });

  const reference = `TEST-${Date.now()}`;
  console.log(`\n--- Initializing payment (ref: ${reference}) ---`);

  try {
    const payment = await client.payment.initialize(
      {
        currency: 'CDF',
        merchantTransactionId: reference,
        amount: 1500,
        lang: 'fr',
        designation: `LinkPay test - ${reference}`,
        clientEmail: 'test@linkpay.cd',
        clientFirstName: 'Test',
        clientLastName: 'User',
        clientPhoneNumber: '+243800000000',
        successUrl: 'http://localhost:5173/payment/success',
        failedUrl: 'http://localhost:5173/payment/failed',
        notifyUrl: process.env.WEBHOOK_NOTIFY_URL || 'http://localhost:3000/api/v1/webhooks/cinetpay',
        channel: 'PUSH',
      },
      COUNTRY,
    );

    console.log('\n✅ Payment initialized!');
    console.log('  Transaction ID:', payment.transactionId || 'N/A');
    console.log('  Payment URL:', payment.paymentUrl);
    console.log('\n  Open this URL in your browser to complete the payment.');
  } catch (err) {
    console.error('\n❌ Payment init failed:', err.message);
    if (err.response) {
      console.error('  Response:', JSON.stringify(err.response, null, 2));
    }
  }
}

main();
