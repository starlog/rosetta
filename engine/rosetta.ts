import { restCall, stringifyWithoutCircular } from "./rest";
import { getLogger } from "./logger";
import { jsonpathmap2 } from "jsonpathmap2";
import jp from 'jsonpath';

const logger = getLogger('out');

export interface rosetta {
  status: number;
  statusText: string;
  headers: object;
  config: object;
  request: object;
  data: object;
  debug: any;
}

//--------------------------------------------------------------------------------------------------
export async function processRosetta(req, handleTable): Promise<rosetta> {
  try {
    let returnVal = false;

    let rosettaObject;
    logger.debug(`url:==>${req.url.split('?')[0]}<==`);

    //----------------------------------------------------------------------------------------------
    // Search table for processing information
    // Note: Since there will be a lots of list here, break from loop is must. Don't change into forEach
    //----------------------------------------------------------------------------------------------
    const matchUrl = req.url.split('?')[0];
    for (const x of handleTable) {
      if ((x.host === req.hostname) || (req.hostname === 'localhost')) { // Passing localhost for test
        for (const y of x.methods) {
          if (y.method === req.method) { // Only search for same method
            for (const z of y.urls) {
              const convertString = z.urlPattern.replaceAll('/', '\/');
              const re = new RegExp(convertString);
              if (re.test(matchUrl)) { // Matching path signature
                rosettaObject = z;
                rosettaObject.matchString = matchUrl.match(re);
                returnVal = true;
                break;
              }
            }
          }
          if (returnVal) break;
        }
      }
      if (returnVal) break;
    }

    //----------------------------------------------------------------------------------------------
    // Handle found call process
    //----------------------------------------------------------------------------------------------
    if (returnVal) {
      const object = {
        request: req,
        save: {},
        response: undefined
      }

      let isBreakNeed = false;
      let breakInformation = {};
      const initStartTime = new Date().valueOf();
      const callTimeList = [];
      const callUrlList = [];
      let callCounter = 0;
      //--------------------------------------------------------------------------------------------
      // process loop
      //--------------------------------------------------------------------------------------------
      for (const singleRequest of rosettaObject.process) {
        logger.debug(`Processing [${singleRequest.sequence}]`);

        //------------------------------------------------------------------------------------------
        // Rest call
        //------------------------------------------------------------------------------------------
        const request = {
          baseURL: `${singleRequest.request.targetServer}`,
          path: `${singleRequest.request.url.path}`,
          method: singleRequest.request.method,
          headers: singleRequest.request?.header?.data ? jsonpathmap2(singleRequest.request.header.data, object) : undefined,
          query: singleRequest.request?.param?.data ? jsonpathmap2(singleRequest.request.param.data, object) : undefined,
          body: singleRequest.request?.body?.data ? jsonpathmap2(singleRequest.request.body.data, object) : undefined,
        };
        //------------------------------------------------------------------------------------------
        // Handle dynamic path
        //------------------------------------------------------------------------------------------
        if (singleRequest.request.url.data && singleRequest.request.url.data.length !== 0) {
          singleRequest.request.url.data.forEach((x, index) => {
            if (x.mode === 'path') {
              request.path = request.path.replace(x.position, rosettaObject.matchString[x.data]);
            } else if (x.mode === 'jsonpath') {
              console.log(stringifyWithoutCircular(object));
              const switchString = jp.query(object, x.data)[0];
              request.path = request.path.replace(x.position, switchString);
            }
          });
        }

        //------------------------------------------------------------------------------------------
        // Handle Scripts
        //------------------------------------------------------------------------------------------
        if (singleRequest.request?.header?.script && singleRequest.request.header.script.length !== 0) {
          singleRequest.request.header.script.forEach((x) => {
            const scriptString = x.script.replace('$1', request.headers[x.target]);
            const scriptFunction = new Function(scriptString);
            request.headers[x.target] = scriptFunction();
          });
        }

        if (singleRequest.request?.param?.script && singleRequest.request.param.script.length !== 0) {
          singleRequest.request.param.script.forEach((x) => {
            const scriptString = x.script.replace('$1', request.query[x.target]);
            const scriptFunction = new Function(scriptString);
            request.query[x.target] = scriptFunction();
          });
        }

        // Must use jsonpath notation for body
        if (singleRequest.request?.body?.script && singleRequest.request.body.script.length !== 0) {
          singleRequest.request.body.script.forEach((x) => {
            const originalValue = jp.query(request, x.target)[0];
            const scriptString = x.script.replace('$1', originalValue);
            const scriptFunction = new Function(scriptString);
            jp.apply(request, x.target, scriptFunction);
          });
        }

        const startTime = new Date().valueOf();
        object.response = await restCall(request);
        callCounter++;
        const endTime = new Date().valueOf();
        callTimeList.push({ duration: (endTime - startTime) });
        callUrlList.push({
          base: `${singleRequest.request.targetServer}`,
          url: `${singleRequest.request.url.path}`
        });

        //------------------------------------------------------------------------------------------
        // handle save
        //------------------------------------------------------------------------------------------
        if (singleRequest.response["save"]) {
          const saveData = jsonpathmap2(singleRequest.response.save, object.response);
          for (const element in saveData) {
            object.save[element] = saveData[element];
          }
        }
        //------------------------------------------------------------------------------------------
        // handle break
        //------------------------------------------------------------------------------------------
        if (singleRequest.response["break"]) {
          for (const item of singleRequest.response.break) {
            const check = jsonpathmap2(item, object.response);
            const checkString = check['decision'].replace('$1', check['value']);
            const checkFunction = new Function(checkString);
            if (checkFunction()) {
              isBreakNeed = true;
              breakInformation = {
                checkCode: checkString,
                responseData: JSON.parse(stringifyWithoutCircular(object.response))
              }
              break;
            } else {
              logger.debug(`Check function pass:${checkString}`);
            }
          }
        }

        //------------------------------------------------------------------------------------------
        // handle return
        //------------------------------------------------------------------------------------------
        if (!isBreakNeed && singleRequest.response?.return) {
          const finalTime = new Date().valueOf();
          return { // Normal return status
            debug: {
              totalDuration: (finalTime - initStartTime),
              interval: callTimeList,
              callCount: callCounter,
              callList: callUrlList
            },
            config: object.response?.config,
            headers: object.response?.headers,
            request: object.response?.request,
            status: object.response?.status,
            statusText: object.response?.statusText,
            data: jsonpathmap2(singleRequest.response.return, object)
          };
        }
      }

      //--------------------------------------------------------------------------------------------
      // Return break detail information (for dev)
      //--------------------------------------------------------------------------------------------
      if (isBreakNeed) {
        logger.error(`Rosetta breaking error: ${breakInformation}`);
        return { // Sanity check fail, possible communication error
          debug: { reason: 'breaking' },
          config: null,
          data: { status: 500, message: '`오류가 발생하였습니다. 잠시후 다시 시도해주세요.`', detail: breakInformation },
          headers: null,
          request: null,
          status: 500,
          statusText: null
        };
      }
    } else {
      //--------------------------------------------------------------------------------------------
      // Did not found handling information so just bypassing and raise alarm
      //--------------------------------------------------------------------------------------------
      logger.error(` NOTFOUND Rosetta cannot handle this, bypassing (But working): ${stringifyWithoutCircular(req)}`);
      const restResult = await restCall(req);
      return {
        debug: undefined,
        config: restResult?.config,
        data: restResult?.data,
        headers: restResult?.headers,
        request: restResult?.request,
        status: restResult?.status,
        statusText: restResult?.statusText
      };
    }
  } catch (ex) {
    //----------------------------------------------------------------------------------------------
    // Critical system error
    //----------------------------------------------------------------------------------------------
    logger.error(`Rosetta critical error: ${ex}`);
    return { // System error
      debug: null,
      config: null,
      data: { status: 500, message: '`오류가 발생하였습니다. 잠시후 다시 시도해주세요.`', detail: ex },
      headers: null,
      request: null,
      status: 500,
      statusText: `Critical error: ${ex}`
    };
  }
}
