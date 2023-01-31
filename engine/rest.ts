import axios, { AxiosResponse } from "axios";
import moment from 'moment';
import http from "http";
import https from "https";
import YAML from 'yaml';
import fs from "fs";
import { Kafka } from 'kafkajs';
import jp from 'jsonpath';
import {getLogger} from "./logger";

let platformConfig;
let kafka;
let kafkaProducer;
let targetHost;

const logger = getLogger('out');

//--------------------------------------------------------------------------------------------------
// 기본 axios 객체를 생성한다.
//--------------------------------------------------------------------------------------------------
let axiosInstance;

//--------------------------------------------------------------------------------------------------
// 중계하지 않을 헤더 값을 지정한다. 기본적으로 content-length 는 제거되어야 한다.
//--------------------------------------------------------------------------------------------------
const headerFilter = ['content-length','host'];

//--------------------------------------------------------------------------------------------------
// Object empty check
//--------------------------------------------------------------------------------------------------
function isEmpty(obj) {
  return Object.keys(obj).length === 0;
}

//--------------------------------------------------------------------------------------------------
// JSON.stringify 시에 circular reference exception 을 제거하기 위한 기능
//--------------------------------------------------------------------------------------------------
const getCircularReplacer = (): any => {
  const seen = new WeakSet();
  return (key: any, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return null;
      }
      seen.add(value);
    }
    return value;
  };
};
export function stringifyWithoutCircular(object: any) {
  let output = object;
  try {
    output = JSON.stringify(object, getCircularReplacer());
  } catch (e) {
    // intentional
  }
  return output;
}


//--------------------------------------------------------------------------------------------------
// 세특 config platform query
//--------------------------------------------------------------------------------------------------
export async function getConfig(){
  try{
    const domain = 'configuration';
    const service = 'translator';

    const queryConfig = {
      method: 'get',
      url: `https://config.internal.washswat.com/v1/config/domain/${domain}/service/${service}`,
      data: undefined,
      params: undefined,
      headers: undefined,
      auth: undefined,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      httpAgent: new http.Agent({ keepAlive: true }),
      httpsAgent: new https.Agent({ keepAlive: true }),
      timeout: 5000,
    };

    const configResult = await axios(queryConfig);

    return configResult.data;

  }catch(ex){
    logger.error(`getConfig try-catch error:${ex}`);
    return null;
  }
}
export async function initRest(){
  // config.yml 읽기
  const file = fs.readFileSync('./config.yml', 'utf8');
  const configData = YAML.parse(file);
  logger.debug(`Using translation target:${configData['target-host']}`);
  targetHost = configData['target-host'];

  // Axios 호출, 한번만 사용하므로 instance 생성하지 않음
  axiosInstance = axios.create({
    baseURL: `${targetHost}`,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 5000,
  });

  // platform config 에서 kafka broker 주소를 획득
  platformConfig = await getConfig();
  const environment = jp.query(platformConfig, '$.common.environment')[0];
  logger.info(`using '${environment}' environment`);
  const kafkaBroker = jp.query(platformConfig, '$.common.kafka.main.brokers')[0];
  logger.debug(`kafka:${kafkaBroker}`);
  kafka = new Kafka({
    clientId: 'rekognitionProducer',
    brokers: kafkaBroker,
  });
  kafkaProducer = kafka.producer();
  await kafkaProducer.connect();

  return true;
}

//--------------------------------------------------------------------------------------------------
// 실 서비스에서는 Kafka 로 해당 내용을 전송하고, MongoDb에 기록은 consumer 가 처리함
//--------------------------------------------------------------------------------------------------
export async function logIt(req,response, duration){
  try{
    // 토큰을 추출해서 별도로 기록
    let token = null;
    let tokenMode = null;
    if(req.headers['x-access-token']){
      token = req.headers['x-access-token'];
      tokenMode = 'legacy';
    }else if(req.headers['x-washswat-token']){
      token = req.headers['x-washswat-token'];
      tokenMode = 'msa';
    }

    // 로그 조립
    const record = {
      time: new Date(),
      token: token,
      tokenMode:tokenMode,
      targetHost: targetHost,
      request : {
        method: `${req.method}`,
        url: req.path,
        query: req.query,
        headers: req.headers,
        body: req.body,
      },
      response: response?.status === 200 ? response.data : JSON.parse(stringifyWithoutCircular(response)),
      duration: duration,
    };
    logger.debug(record);

    await kafkaProducer.send({
      topic: 'translator',
      messages: [
        {
          key: null,
          value: JSON.stringify(record),
        }
      ]
    });
  }catch(ex){
    logger.error(`logIt Error: ${ex}`);
  }
}


//--------------------------------------------------------------------------------------------------
// 실 API 를 호출하는 부분
//--------------------------------------------------------------------------------------------------
export async function restCall(req): Promise<AxiosResponse<any, any>> {
  try{
    const headers = {};
    for(const element in req.headers){
      if(headerFilter.indexOf(`${element}`) === -1){
        headers[`${element}`] = `${req.headers[element]}`;
      }
    }

    const queryConfig = {
      baseURL: req.baseURL ? req.baseURL : undefined,
      method: req.method,
      url: req.path,
      data: req.body ? (isEmpty(req.body) ? undefined: req.body) : undefined,
      params: req.query ? (isEmpty(req.query) ? undefined: req.query) : undefined,
      headers: headers? (isEmpty(headers) ? undefined: headers) : undefined,
      auth: undefined,
    };

    const startTime = moment().valueOf();
    let result;
    try{
      result = await axiosInstance.request(queryConfig);
    }catch(ex){
      if(ex.name === 'AxiosError'){
        result = ex.response;
      }else{
        result = {
          status: 500,
          statusText: 'axiosCall, non AxiosError error',
          data: ex,
          headers: null,
          config: null,
        };
      }
    }
    const endTime = moment().valueOf();
    const duration = endTime - startTime;

    await logIt(req,result, duration);

    return result;
  }catch(ex){
    logger.error(`restCall primary try-catch:${ex}`);
    return {
      status: 500,
      statusText: 'try-catch error',
      data: ex,
      headers: null,
      config: null,
    };
  }
}
