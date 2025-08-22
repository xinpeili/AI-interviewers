// cloudfunctions/ping/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// main function
exports.main = async (event, context) => {
  console.log('Ping function invoked');
  return {
    message: 'pong',
    timestamp: new Date()
  };
};