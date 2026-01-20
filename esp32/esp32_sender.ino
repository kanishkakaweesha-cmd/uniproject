/* esp32_sender.ino
 * Example sketch that uses the Telemetry library to POST weight, volume, fee to a web app
 * Requires: ArduinoJson, built-in WiFi and HTTPClient on ESP32
 */

#include "Telemetry.h"

// Fill these with your WiFi credentials and server info
const char* WIFI_SSID = "YOUR_SSID";
const char* WIFI_PASS = "YOUR_PASSWORD";
// You can pass full URL like: "http://192.168.1.100:5000" or host "192.168.1.100" with port
const char* SERVER_URL = "http://192.168.1.100:5000"; // change to your machine's IP where the web app runs

Telemetry telemetry(WIFI_SSID, WIFI_PASS, SERVER_URL, 5000);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Starting telemetry sender...");
  if (!telemetry.begin(10000)) {
    Serial.println("WiFi connection failed - will retry on send");
  } else {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  }
}

void loop() {
  // Replace the following with real sensor reads
  float weight = random(100, 200) / 10.0; // mock weight in grams
  float volume = random(50, 200) / 10.0;  // mock volume
  const char* feeType = "A";
  float fee = weight * 0.5; // mock fee calculation

  Serial.print("Sending: ");
  Serial.print(weight); Serial.print("g, ");
  Serial.print(volume); Serial.print("cm3, ");
  Serial.print("fee "); Serial.println(fee);

  bool ok = telemetry.send(weight, volume, feeType, fee);
  if (ok) Serial.println("Telemetry sent");
  else Serial.println("Telemetry failed to send");

  delay(2000);
}
