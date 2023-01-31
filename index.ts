//--------------------------------------------------------------------------------------------------
// Universal translator/protocol logger
// - 특정 서버로 동작하면서 모든 http method 및 URL 을 수신 받아서,
//   해당 내용 그대로 타켓 서버에 전송해서 응답을 받고
//   요청 및 응답을 Kafka 로 전송해서 documentDB에 로깅한다.
// - 타겟 서버는 config.yml 의 데이터를 사용한다.
//--------------------------------------------------------------------------------------------------
import express from 'express';
import bodyParser from "body-parser";
import { processRosetta} from "./engine/rosetta";
import { initRest, stringifyWithoutCircular } from './engine/rest';
import { getLogger } from "./engine/logger";
import {initMongo,getRecords,getTable} from "./engine/mongodb";

const logger = getLogger('out');

//--------------------------------------------------------------------------------------------------
// express 설정
//--------------------------------------------------------------------------------------------------
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text());

//--------------------------------------------------------------------------------------------------
// 서비스 초기화, config.yml 에서 타겟 호스트 정보를 읽어와서 axios 객체를 생성한다.
//--------------------------------------------------------------------------------------------------
async function init() {
  // config.yml 읽기
  await initRest();
  const mongoInitResult = await initMongo();
  if(!mongoInitResult){
    logger.error(`CRITICAL, mongodb init error: ${mongoInitResult}`);
    process.exit(-1);
  }
  const tableReadResult = await getRecords();
  if(!tableReadResult){
    logger.error(`CRITICAL, mongodb read record error`);
    process.exit(-1);
  }
  return true;
}

//--------------------------------------------------------------------------------------------------
// 메인 루프
//--------------------------------------------------------------------------------------------------
init().then(() => {
  app.all('*', (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/health-check') { // health-check 호출에 대해서는 후방을 호출하지 않고 직접 응답한다.
        res.send({ message: 'success' });
      } else {
        processRosetta(req, getTable()).then((response) => {
          if (response.status === 200) {
            if(response.debug){
              res.set('x-washswat-debug',JSON.stringify(response.debug));
            }
            res.send(response.data);
          } else {
            if(response.debug){
              res.set('x-washswat-debug', JSON.stringify(response.debug));
            }
            res.status(response.status).json(response?.data);
          }
        });
      }
    } catch (ex) {
      res.status(500).json({ message: stringifyWithoutCircular(ex) });
    }
  });

  const server = app.listen(3000, () => {
    logger.info('Server running on http://localhost:3000');
  });

  // server.keepAliveTimeout = 65 * 1000;
  // server.headersTimeout = 65 * 1000;

});
