// Telemetry.cpp
#include "Telemetry.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

Telemetry::Telemetry(const char* ssid, const char* password, const char* serverUrl, uint16_t serverPort)
 : _ssid(ssid), _password(password), _serverUrl(serverUrl), _serverPort(serverPort), _wifiConnected(false) {}

bool Telemetry::ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    _wifiConnected = true;
    return true;
  }
  unsigned long start = millis();
  WiFi.begin(_ssid, _password);
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 10000) {
      _wifiConnected = false;
      return false;
    }
    delay(200);
  }
  _wifiConnected = true;
  return true;
}

bool Telemetry::begin(unsigned long timeoutMs) {
  unsigned long start = millis();
  WiFi.begin(_ssid, _password);
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) return false;
    delay(200);
  }
  _wifiConnected = true;
  return true;
}

bool Telemetry::send(float weight, float volume, const char* feeType, float fee) {
  if (!ensureWiFi()) return false;

  HTTPClient http;
  String url;
  // support passing full URL (http://host[:port]) or host only
  if (strstr(_serverUrl, "http://") == _serverUrl || strstr(_serverUrl, "https://") == _serverUrl) {
    url = String(_serverUrl) + "/api/packages";
  } else {
    url = String("http://") + _serverUrl + ":" + String(_serverPort) + "/api/packages";
  }

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["weight"] = weight;
  doc["volume"] = volume;
  doc["feeType"] = feeType;
  doc["fee"] = fee;

  String payload;
  serializeJson(doc, payload);

  int code = http.POST(payload);
  http.end();
  return (code >= 200 && code < 300);
}
