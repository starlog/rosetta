import * as mongodb from 'washswat-engine/lib/mongodb'
import { getLogger } from "./logger";

const logger = getLogger('out');

const mongoConnections = [
  {
    name: 'translator',
    url: 'mongodb://'
      + 'washswat:!Washswat101@washswat.mongo.internal:27017'
      + '?replicaSet=rs0&readPreference=secondaryPreferred',
    options: {
      poolSize: 2,
      connectTimeoutMS: 2000,
    },
    useCache: false,
    CacheTtl: 60,
  },
];

let savedTable;

//--------------------------------------------------------------------------------------------------
export async function initMongo() {
  const result = await mongodb.init(mongoConnections);
  return result.status;
}

//--------------------------------------------------------------------------------------------------
export function getTable(){
  return savedTable;
}

//--------------------------------------------------------------------------------------------------
export async function getRecords() {
  try {
    const qs = {
      name: 'translator',
      db: 'translator',
      collection: 'translation-table',
      query: {},
      fields: {},
      sort: { host: 1, method: 1 },
      skip: 0,
      limit: 5000
    }
    const result = await mongodb.find(qs);

    logger.debug(`MongoDB:Processing ${result.data.length} records.`);
    const recordTable = [];
    result.data.forEach((x) => {
      // Check if host exists
      const hostIndex = recordTable.findIndex(p => p.host === x.host);
      if (hostIndex === -1) { // First host record
        recordTable.push({
          host: x.host,
          methods: [{
            method: x.method,
            urls: [{ urlPattern: x.url, process: x.process }]
          }]
        });
      }else{ // Not first host record
        // Check if method exists
        const methodIndex = recordTable[hostIndex].methods.findIndex(p => p.method === x.method);
        if(methodIndex === -1){ // First method record
          recordTable[hostIndex].methods.push({
            method: x.method,
            urls: [{ urlPattern: x.url, process: x.process }]
          });
        }else{ // Not first method record
          // Check if url exists
          const urlIndex = recordTable[hostIndex].methods[methodIndex].urls.findIndex(p => p.urlPattern === x.url);
          if(urlIndex === -1){ // First url record
            recordTable[hostIndex].methods[methodIndex].urls.push({
              urlPattern: x.url, process: x.process
            });
          }else{ // Not first url record
            // MongoDB has unique key to counter this case so this is just a precaution.
            logger.error(`CRITICAL, duplication found ${x.host}:${x.method}:${x.url}`);
            return false;
          }
        }
      }
    });
    // logger.debug(JSON.stringify(recordTable,null,2));
    savedTable = recordTable; // Save result
    return true;
  } catch (ex) {
    return false;
  }
}

