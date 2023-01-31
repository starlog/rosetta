# rosetta
REST API Translation engine
# 코드네임: Rosetta (API Call translator) specification

본 프로젝트는 특정 API Call을 다른 형태의 API Call로 통역하기 위한 기능을 구현한다.

아래 JSON은 Rosetta 기능을 설명하기 위한 MongoDB 샘플이다.

```json
{ 
    "_id" : ObjectId("63d8786b8dccd24378b4ec2e"), 
    "host" : "wash-api-trans.washswat.com", 
    "method" : "POST", 
    "url" : "/openapi/order/time/delivery$", 
    "process" : [
        {
            "sequence" : 0.0, 
            "note" : "기본 호출 테스트", 
            "request" : {
                "targetServer" : "http://wash-api.washswat.internal:8000", 
                "method" : "POST", 
                "url" : {
                    "path" : "/openapi/order/time/delivery"
                }, 
                "header" : {
                    "data" : {
                        "access-token" : "$.request.headers['access-token']", 
                        "content-type" : "$.request.headers['content-type']"
                    }, 
                    "script" : [
                        {
                            "target" : "content-type", 
                            "script" : "return '$1'+'ING'"
                        }
                    ]
                }, 
                "param" : {
                    "data" : {
                        "testParam" : "$.request.query.testparam"
                    }, 
                    "script" : [
                        {
                            "target" : "testParam", 
                            "script" : "return '$1'+'ING'"
                        }
                    ]
                }, 
                "body" : {
                    "data" : {
                        "pickupTime" : "$.request.body.pickupTime", 
                        "postCode" : "$.request.body.postCode", 
                        "test" : {
                            "value" : "xxx"
                        }
                    }, 
                    "script" : [
                        {
                            "target" : "$.body.test.value", 
                            "script" : "return '$1'+'ING'"
                        }
                    ]
                }
            }, 
            "response" : {
                "return" : {
                    "code" : "$.response.data.code", 
                    "message" : "$.response.data.message", 
                    "data" : "$.response.data.data"
                }
            }
        }
    ]
}
```

## 처리 순서

Process내부에는 한개 이상의 레코드가 존재하며, Rosetta는 순서대로 처리하여 결과를 조립한다.

## 기본 데이터

```json
"sequence": 0,
"note": "기본 호출 테스트",
"request": {
  "targetServer": "http://wash-api.washswat.internal:8000",
  "method": "POST",
  "url": {
    "path": "/openapi/:order/time/delivery",
"data" : [
            {
                "mode" : "path", 
                "position" : ":order", 
                "data" : 1.0
            }, 
            {
                "mode" : "jsonpath", 
                "position" : ":order", 
                "data" : "$.request.query.testparam"
            }
        ]
```

sequence: 처리 순서를 표시한다. sorting되어 있으므로 별도 처리는 필요 없다.

note: 스크립트 작성자가 사용하는, 기능과 관계 없는 주석문

request.targetServer: 호출할 실 기능 서버

request.method: 호출할 실 기능 서버의 http method(대문자)

request.url.path: 호출할 실 기능 서버의 url path

request.url.data: 호출할 실 기능 서버의 url에 동적 데이터가 포함된 경우, 이를 처리하기 위한 데이터. 즉 request.url.path중에서 “:”로 시작하는 부분을 어떤 데이터로 변환할지를 지정한다. 두가지 모드를 제공한다.

## request.url.path

**mode: path** 를 사용하기 위해서는 아래와 같이 url이 regular expression을 포함하여야 한다.

```json
{ 
    "_id" : ObjectId("63d8786b8dccd24378b4ec2e"), 
    "host" : "wash-api-trans.washswat.com", 
    "method" : "POST", 
    "url" : "/openapi/(.+)/time/delivery$", 
    "process" : [
        {
```

위와 같이 url이 구성되어 있다고 가정할때, 호출받은 UIRL  분석에 의해서 동적 파라메터 또는 파라메터의 목록이 획득된다. (예를들어 /openapi/order/time/delivery로 호출되었다고 가정하면, “order”가 동적 파라메터로 획득된다. )

이 경우에 path: “/openapi/:order/time/delivery”에서 data: 1.0에 의해서 첫번째 동적 파라메터(”order”)가 position: “:order” 자리에 삽입되어서 최종 url은 /openapi/order/time/delivery가 된다.

**mode:jsonpath** 는 path: “/openapi/:order/time/delivery”에서 data값을 jsonpath로 해석하여 획득한 값 (여기서는 order라고 가정하면)을 position의 위치에 삽입하여 최종 url은 /openapi/order/time/delivery가 된다.

## Table Building

Rosetta는 구동시에 mongodb에 저장된 모든 데이터를 불러와서, 아래와 같은 구조로 모든 데이터를 정리한다.

```json
[
  {
    "host": "wash-api-trans.washswat.com",
    "methods": [
      {
        "method": "POST",
        "urls": [
          {
            "urlPattern": "/openapi/order/time/delivery2$",
            "process": [
              {
```

즉, Host가 동일한 레코드를 모으고, 그 중에서 method가 동일한 레코드를 모으고, 그 하부에 urlPattern별 레코드를 저장한다. 이 구조는 Rosetta가 mongodb의 레코드를 이용해서 조립한 것이다.

## Rule Match Process

Rosetta는 클라이언트가 호출할때, 다음과 같은 순서로 보유한 translation 레코드와 매칭을 시도한다.

1. host가 동일한 레코드를 찾는다
2. method가 동일한 레코드를 찾는다.
3. urlPattern과 동일한(regular expression사용) 레코드를 찾는다
4. 동일한 레코드의 process 데이터를 획득한다.

## Header 처리

Process 내부의 header section은 다음과 같다.

```json
"header": {
  "data": {
    "access-token": "$.request.headers['access-token']",
    "content-type": "$.request.headers['content-type']"
  },
  "script": [{
    "target": "content-type",
    "script": "return '$1'+'ING'"
  }]
},
```

| data | request 데이터를 jsonpath로 추출하는 방법을 정의한다. |
| --- | --- |
| script | 추출된 데이터를 스크립트로 수정하는 방법을 정의한다. 상기 샘플은, header중에서 content-type에 대해서 ‘ING’ 스트링을 추가하게 된다. |

## Param 처리

Process 내부의 param section은 다음과 같다.

```json
"param": {
  "data": {
    "testParam": "$.request.query.testparam"
  },
  "script": [
    {
      "target": "testParam",
      "script": "return '$1'+'ING'"
    }
  ]
},
```

| data | request 데이터를 jsonpath로 추출하는 방법을 정의한다. |
| --- | --- |
| script | 추출된 데이터를 스크립트로 수정하는 방법을 정의한다. 상기 샘플은, parameter중에서 testParam에 대해서 ‘ING’ 스트링을 추가하게 된다. |

## Body 처리

Process 내부의 body section은 다음과 같다.

```json
"body": {
  "data": {
    "pickupTime": "$.request.body.pickupTime",
    "postCode": "$.request.body.postCode",
    "test": {
      "value": "xxx"
    }
  },
  "script": [
    {
      "target": "$.body.test.value",
      "script": "return '$1'+'ING'"
    }
  ]
}
```

| data | request 데이터를 jsonpath로 추출하는 방법을 정의한다. |
| --- | --- |
| script | 추출된 데이터를 스크립트로 수정하는 방법을 정의한다. 상기 샘플은, body data 중에서 test.value에 대해서 ‘ING’ 스트링을 추가하게 된다. 주의할 점은, 상기 header나 param과는 달리 body에 대해서는 target을 jsonpath 형태로 기록하여야 한다. 이는 body 데이터가 일반적으로 계층으로 이루어지는 경우가 많기 때문에 이러한 형태로 구현되었다. |

## Response 처리

만약 process내에서 마지막이 아닌 레코드의 경우에는 다음과 같이 정의되어 있는 것이 일반적이다.

```json
"response": {
  "break": [
    {
      "value": "$.data.code",
      "decision": "if(parseInt('$1')!== 200){return true;}else{return false;}"
    }
  ],
  "save": {
    "value1": "$.data.code",
    "value2": "$.data.message"
  }
}
```

Response.break가 존재하면, Rosetta는 해당 스크립트를 실행해서 false가 리턴되는 경우에는 진행을 중단하고 호출한 클라이언트에 에러를 리턴한다.

Response.save가 존재하면, Rosetta는 해당 결과를 지정한 변수로 저장한다. 이렇게 저장된 변수는 이후 스텝에서 다시 호출하여 최종 결과의 일부로 사용할 수 있다.

만약 process내에서 마지막 레코드인 경우에는 다음과 같이 정의되어 있는 것이 일반적이다.

```json
"response": {
  "return": {
    "code": "$.response.data.code",
    "message": "$.response.data.message",
    "data": "$.response.data.data"
  }
}
```

Response.return이 존재하는 경우에는 호출한 클라이언트에 리턴할 데이터를 정의한다. 리턴할 데이터를 정의하는 방법은 상기 샘플처럼 “$.response”를 이용해서 지금 처리한 레코드의 응답 데이터를 사용하거나, ‘$.save”를 이용해서 이전 레코드에서 저장한 값을 추출해서 사용할 수 있다. 예를들어 value1의 값을 사용하려면 “$.save.value1”으로 지정할 수 있다.

## Minimal Record

아래 레코드는 최소한의 데이터를 정의하고 있다. 즉, 내용이 존재하지 않는 param과 같은 키는 생략이 가능하다.

```json
{ 
    "host" : "wash-api-trans.washswat.com", 
    "method" : "POST", 
    "url" : "/openapi/order/time/delivery$", 
    "process" : [
        {
            "sequence" : 0.0, 
            "note" : "가장 기본적인 호출 예저", 
            "request" : {
                "targetServer" : "http://wash-api.washswat.internal:8000", 
                "method" : "POST", 
                "url" : {
                    "path" : "/openapi/order/time/delivery"
                }, 
                "header" : {
                    "data" : {
                        "access-token" : "$.request.headers['access-token']", 
                        "content-type" : "$.request.headers['content-type']"
                    }
                }, 
                "body" : {
                    "data" : {
                        "pickupTime" : "$.request.body.pickupTime", 
                        "postCode" : "$.request.body.postCode"
                    }
                }
            }, 
            "response" : {
                "return" : {
                    "code" : "$.response.data.code", 
                    "message" : "$.response.data.message", 
                    "data" : "$.response.data.data"
                }
            }
        }
    ]
}
```

## Code Repository:

[](https://gitlab.washswat.com/felix/wash-api-trans-version-2-rosetta)
