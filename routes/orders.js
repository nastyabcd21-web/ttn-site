УСІ ШЛЯХИ (53):
/api/auth/login
/api/auth/login-as
/api/auth/logout
/api/auth/verify
/api/auth/refresh
/api/partner/static-token
/api/partner/static-token/{id}
/api/track
/api/track/3pl
/api/track/label
/api/track/status
/api/track/status-group
/api/track/recipient
/api/track/estimated-delivery-date
/api/track/{id}
/api/track/public/{id}
/api/track/return
/api/track/archive
/api/track/extend-expiration-date/{id}
/api/private/track
/api/department
/api/department/export-file
/api/department/map-data
/api/city
/api/billing/balance
/api/billing/current-balance
/api/billing/logistic/search-data
/api/billing/logistic/search
/api/billing/logistic/export
/api/billing/invoice/payment-status
/api/billing/invoice/search
/api/billing/invoice/download
/api/billing/invoice/payment-url
/api/billing/invoice/create
/api/track-status
/api/goods/available-departments
/api/goods/list
/api/goods
/api/goods/{id}
/api/goods/by-article/{article}
/api/goods/departments-stock
/api/warranty
/api/carrier
/api/invoice/search-data
/api/invoice
/api/reception/create
/api/reception/add-tracks/{id}
/api/reception/list
/api/reception/{id}
/api/reception/print/{id}
/api/reception/remove-tracks/{id}
/api/reception/public/{id}
/api/reception-status

--- ШЛЯХИ З "track" АБО "label" ---
/api/track
/api/track/3pl
/api/track/label
/api/track/status
/api/track/status-group
/api/track/recipient
/api/track/estimated-delivery-date
/api/track/{id}
/api/track/public/{id}
/api/track/return
/api/track/archive
/api/track/extend-expiration-date/{id}
/api/private/track
/api/track-status
/api/reception/add-tracks/{id}
/api/reception/remove-tracks/{id}

--- ДЕТАЛІ (JSON) ---
{
  "/api/track/label": {
    "get": {
      "operationId": "TrackController_getTrackLabel",
      "summary": "Отримати етикетки для списку експрес-накладних",
      "parameters": [
        {
          "name": "id",
          "required": true,
          "in": "query",
          "description": "Список ідентифікаторів експрес-накладних",
          "example": [
            "101000000000",
            "101000000001"
          ],
          "schema": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      ],
      "responses": {
        "200": {
          "description": "Запит виконався успішно",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/GetTrackLabelResponseDTO"
              }
            }
          }
        }
      },
      "tags": [
        "Експрес-накладна (ЕН)"
      ],
      "security": [
        {
          "bearer": []
        }
      ]
    }
  },
  "/api/track/{id}": {
    "get": {
      "operationId": "TrackController_getTrack",
      "summary": "Отримати детальну інформацію про експрес-накладну",
      "parameters": [
        {
          "name": "id",
          "required": true,
          "in": "path",
          "description": "Ідентифікатор експрес-накладної",
          "example": "101000000000",
          "schema": {
            "type": "string"
          }
        }
      ],
      "responses": {
        "200": {
          "description": "Запит виконався успішно",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/GetTrackResponseDTO"
              }
            }
          }
        }
      },
      "tags": [
        "Експрес-накладна (ЕН)"
      ],
      "security": [
        {
          "bearer": []
        }
      ]
    },
    "patch": {
      "operationId": "TrackController_updateTrack",
      "summary": "Оновити детальну інформацію про експрес-накладну",
      "parameters": [
        {
          "name": "id",
          "required": true,
          "in": "path",
          "description": "Ідентифікатор експрес-накладної",
          "example": "101000000000",
          "schema": {
            "type": "string"
          }
        }
      ],
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/UpdateTrackRequestDTO"
            }
          }
        }
      },
      "responses": {
        "200": {
          "description": "Запит виконався успішно",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/BaseResponseDTO"
              }
            }
          }
        }
      },
      "tags": [
        "Експрес-накладна (ЕН)"
      ],
      "security": [
        {
          "bearer": []
        }
      ]
    }
  },
  "/api/track": {
    "post": {
      "operationId": "TrackController_create",
      "summary": "Створити експрес-накладну",
      "parameters": [],
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CreateTrackRequestDTO"
            }
          }
        }
      },
      "responses": {
        "201": {
          "description": "Запит виконався успішно",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateTrackResponseDTO"
              }
            }
          }
        }
      },
      "tags": [
        "Експрес-накладна (ЕН)"
      ],
      "security": [
        {
          "bearer": []
        }
      ]
    },
    "get": {
      "operationId": "TrackController_getTrackList",
      "summary": "Отримати список експрес-накладних",
      "parameters": [
        {
          "name": "page",
          "required": false,
          "in": "query",
          "description": "Номер сторінки",
          "example": 1,
          "schema": {
            "type": "number"
          }
        },
        {
          "name": "limit",
          "required": false,
          "in": "query",
          "description": "Кількість записів на сторінку",
          "example": 10,
          "schema": {
            "type": "number"
          }
        },
        {
          "name": "sort",
          "required": false,
          "in": "query",
          "description": "Порядок сортування по даті створення, за замовчуванням від нових до старих",
          "example": "ASC",
          "schema": {
            "default": "DESC"
          }
        },
        {
          "name": "id",
          "required": false,
          "in": "query",
          "description": "Ідентифікатор експрес-накладної. Передбачає пошук по не повному номеру ЕН (від 4х символів)",
          "example": "101000000000",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "is_archived",
          "required": false,
          "in": "query",
          "description": "Статус додавання експрес-накладної в архів",
          "example": true,
          "schema": {
            "default": false,
            "type": "boolean"
          }
        },
        {
          "name": "is_deleted",
          "required": false,
          "in": "query",
          "description": "Статус видалення експрес-накладної",
          "example": true,
          "schema": {
            "default": false,
            "type": "boolean"
          }
        },
        {
          "name": "status",
          "required": false,
          "in": "query",
          "description": "Статус(и)",
          "example": [
            10070,
            60030
          ],
          "schema": {
            "type": "array",
            "items": {}
          }
        },
        {
          "name": "created_date_start",
          "required": false,
          "in": "query",
          "description": "Фільтр відображає всі посилки створені від вказаної дати. Приклад: 2023-08-28 - віддасть всі посилки, що були створені з 28.08 до поточної дати. Для отримання фільтру в конкретній даті, треба передавати значення і created_date_start і created_date_end цією датою",
          "example": "2023-08-24",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "created_date_end",
          "required": false,
          "in": "query",
          "description": "Фільтр відображає всі посилки створені до вказаної дати включно",
          "example": "2023-08-24",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "departure_date_start",
          "required": false,
          "in": "query",
          "description": "Фільтр відображає всі посилки відправлені від вказаної дати. Приклад: 2023-08-28 - віддасть всі посилки, що були відправлені з 28.08 до поточної дати. Для отримання фільтру в конкретній даті, треба передавати значення і departure_date_start і departure_date_end цією датою",
          "example": "2023-08-24",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "departure_date_end",
          "required": false,
          "in": "query",
          "description": "Фільтр відображає всі посилки відправлені до вказаної дати включно",
          "example": "2023-08-24",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "visible_id",
          "required": false,
          "in": "query",
          "description": "Номер інтернет-замовлення",
          "example": "ROZ123456789",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "recipient_name",
          "required": false,
          "in": "query",
          "description": "ПІБ отримувача",
          "example": "Сковорода Григорій Савич",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "recipient_phone",
          "required": false,
          "in": "query",
          "description": "Контактний телефоний отримувача",
          "example": "380671234567",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "partner_type",
          "required": false,
          "in": "query",
          "description": "Тип партнера, яким створена експрес-накладна",
          "example": [
            "rz-delivery"
          ],
          "schema": {
            "default": [
              "rz-delivery"
            ],
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "rz-delivery",
                "rozetka-marketplace"
              ]
            }
          }
        },
        {
          "name": "is_third_party_logistics",
          "required": false,
          "in": "query",
          "description": "Ознака фулфілменту",
          "example": true,
          "schema": {
            "type": "boolean"
          }
        },
        {
          "name": "carrier",
          "required": false,
          "in": "query",
          "description": "Зовнішні ідентифікатори перевізників",
          "example": [
            "bdbbcc43-c4c5-4557-bf19-3ef4c76d6b17",
            "1a89d5af-c402-4938-a2f1-b2c1d042331a"
          ],
          "schema": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        {
          "name": "expiration_date_exists",
          "required": false,
          "in": "query",
          "description": "Закінчується резерв",
          "example": true,
          "schema": {
            "type": "boolean"
          }
        },
        {
          "name": "sender_department_carrier",
          "required": false,
          "in": "query",
          "description": "Зовнішній ідентифікатор перевізника відділення відправника",
          "example": "bdbbcc43-c4c5-4557-bf19-3ef4c76d6b17",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "recipient_department_carrier",
          "required": false,
          "in": "query",
          "description": "Зовнішній ідентифікатор перевізника відділення отримувача",
          "example": "bdbbcc43-c4c5-4557-bf19-3ef4c76d6b17",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "sender_department",
          "required": false,
          "in": "query",
          "description": "Зовнішній ідентифікатор відділення відправки",
          "example": "d91a2ddc-a512-4eb3-8fe8-fbdd04116ae3",
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "has_insurance_compensation_cost",
          "required": false,
          "in": "query",
          "description": "Ознака наявності вартості послуги компенсації",
          "example": true,
          "schema": {
            "type": "boolean"
          }
        }
      ],
      "responses": {
        "200": {
          "description": "Запит виконався успішно",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/GetTrackListResponseDTO"
              }
            }
          }
        }
      },
      "tags": [
        "Експрес-накладна (ЕН)"
      ],
      "security": [
        {
          "bearer": []
        }
      ]
    },
    "delete": {
      "operationId": "TrackController_deleteTracks",
      "summary": "Видалити експрес-накладні",
      "parameters": [],
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/DeleteTrackRequestDTO"
            }
          }
        }
      },
      "responses": {
        "200": {
          "description": "Запит виконався успішно",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/BaseResponseDTO"
              }
            }
          }
        }
      },
      "tags": [
        "Експрес-накладна (ЕН)"
      ],
      "security": [
        {
          "bearer": []
        }
      ]
    }
  }
}
