const rp = require('request-promise');
const Redis = require('ioredis');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');

const { ManageProgramInfo, RedisRunConfig } = require('./config.json');

const write = promisify(fs.writeFile);
const del = promisify(fs.unlink);
const pExec = promisify(exec);


(async () => {
  // get redis config
  const address = process.env.RegisterAddress || ManageProgramInfo.Address;
  const thisKey = process.env.RegisterKey || ManageProgramInfo.DefaultRegisterKey;
  let res = { suc: true };
  const reqOptions = {
    uri: address + ManageProgramInfo.Router + '?key=' + thisKey,
    method: 'GET',
    json: true
  }
  res = await rp(reqOptions)
    .catch(err => res = { suc: false, err });
  if (!res || res.suc === false) {
    console.log('register failed, err: ', res.err);
    return;
  }
  // get two redis instances
  const redisConfig = {
    keyPrefix: res.data.keyPrefix,
    host: res.data.RedisHost,
    port: res.data.RedisPort,
    password: res.data.Password,
    db: res.data.DB,
    family: 4,
  }
  const listenRedis = new Redis(redisConfig);
  const taskRedis = new Redis(redisConfig);

  // listen to be catched
  listenRedis.subscribe(res.data.DockerServiceSub);
  console.log('process start');
  // listen the task queue
  while (true) {
    const keyRes = await taskRedis.blpop(res.data.TaskQueue, RedisRunConfig.WaitTime);
    if (keyRes === null) { continue; }
    const key = keyRes[1];
    const code = await taskRedis.get(key);
    const runRes = await runCode(code);
    await taskRedis.hmset(key + res.data.Responsesuffix, runRes);
  }
})();

// run code and return the result
async function runCode(code) {
  const ret = { suc: true };
  // code save
  const fileUrl = `/ns-3-dev/scratch/temp.cc`;
  await write(fileUrl, code).catch((err) => {
    ret.suc = false;
    ret.err = err;
  });
  if (ret.suc === false) { return ret; }
  ret.runInfo_startTime = Date.now();
  // run
  const result = await pExec(`cd /ns-3-dev && ./waf --run ${fileName}`, { timeout: 20000}) //写死 20s超时
    .catch((err) => {
      ret.suc = false;
      ret.runInfo_err = err;
      ret.runInfo_endTime = Date.now();
    });
    // file delete
  await del(fileUrl);
  if (ret.suc === false) { return ret; }
  // result return
  ret.runInfo_stdout = result.stdout;
  ret.runInfo_stderr = result.stderr;
  return ret;
}