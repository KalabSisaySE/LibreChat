const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { askQuestion, silentExit } = require('./helpers');
const { isEnabled } = require('~/server/utils/handleText');
const User = require('~/models/User');
const Balance = require('~/models/Balance');
const connect = require('./connect');

(async () => {
  await connect();

  /**
   * Show the welcome / help menu
   */
  console.purple('--------------------------');
  console.purple('Checks a user balance!');
  console.purple('--------------------------');
  /**
   * Set up the variables we need and get the arguments if they were passed in
   */
  let email = '';

  // If we have the right number of arguments, lets use them
  if (process.argv.length >= 2) {
    email = process.argv[2];
  } else {
    console.orange('Usage: npm run check-balance <email>');
    console.orange('Note: if you do not pass in the arguments, you will be prompted for them.');
    console.purple('--------------------------');
    // console.purple(`[DEBUG] Args Length: ${process.argv.length}`);
  }

  if (!process.env.CHECK_BALANCE) {
    console.red(
      'Error: CHECK_BALANCE environment variable is not set! Configure it to use it: `CHECK_BALANCE=true`',
    );
    silentExit(1);
  }
  if (isEnabled(process.env.CHECK_BALANCE) === false) {
    console.red(
      'Error: CHECK_BALANCE environment variable is set to `false`! Please configure: `CHECK_BALANCE=true`',
    );
    silentExit(1);
  }

  /**
   * If we don't have the right number of arguments, lets prompt the user for them
   */
  if (!email) {
    email = await askQuestion('Email:');
  }
  // Validate the email
  if (!email.includes('@')) {
    console.red('Error: Invalid email address!');
    silentExit(1);
  }

  // Validate the user
  const user = await User.findOne({ email }).lean();
  if (!user) {
    console.red('Error: No user with that email was found!');
    silentExit(1);
  } else {
    console.purple(`Found user: ${user.email}`);
  }

  /**
   * Fetch balance for the user
   */

  let balance = await Balance.findOne({ user: user._id });
  if (balance !== null) {
    console.green(`User Balance: ${balance.tokenCredits}`);
  } else {
    console.yellow('User Balance: 0');
  }

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (err.message.includes('fetch failed')) {
    return;
  } else {
    process.exit(1);
  }
});
