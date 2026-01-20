// Telemetry.h
// Small helper library for ESP32 to send telemetry (weight, volume, fee) to a web app

#ifndef TELEMETRY_H
#define TELEMETRY_H

#include <Arduino.h>
#include <WiFi.h>

class Telemetry {
public:
  Telemetry(const char* ssid, const char* password, const char* serverUrl, uint16_t serverPort = 80);
  bool begin(unsigned long timeoutMs = 10000);
  // feeType is a C string (e.g., "A"), fee is numeric
  bool send(float weight, float volume, const char* feeType, float fee);

private:
  const char* _ssid;
  const char* _password;
  const char* _serverUrl; // either host or full URL depending on use
  uint16_t _serverPort;
  bool _wifiConnected;
  bool ensureWiFi();
};

#endif // TELEMETRY_H
