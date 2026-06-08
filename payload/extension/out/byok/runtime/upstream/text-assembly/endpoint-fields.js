"use strict";

const { tryFromEndpointFieldsBasic } = require("./endpoint-fields-basic");

function tryFromEndpointFields(endpoint, rawBody) {
  return tryFromEndpointFieldsBasic(endpoint, rawBody);
}

module.exports = {
  tryFromEndpointFields
};

