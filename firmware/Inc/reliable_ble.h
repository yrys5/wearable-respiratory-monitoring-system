#ifndef RELIABLE_BLE_H
#define RELIABLE_BLE_H
#include <stdint.h>

#define RBL_CAPACITY 512u
#define RBL_WINDOW 8u
#define RBL_TIMEOUT_MS 500u
#define RBL_PACE_MS 10u
#define RBL_PACKET_SIZE 20u
#define RBL_CMD_ACK 1u
#define RBL_CMD_START 2u
#define RBL_CMD_STOP 3u
#define RBL_CMD_RESUME 4u
#define RBL_ACTIVE 1u
#define RBL_OVERFLOW 2u
#define RBL_ADC_GAP 4u
#define RBL_SEQUENCE_LIMIT 8u
#define RBL_READY 16u
#define RBL_CONNECTED 32u
#define RBL_SUBSCRIBED 64u

/* All calls run in the main/sequencer context, NOT from an ISR. */
typedef int (*RBL_SendFn)(const uint8_t packet[20]); /* 0 = stack accepted */
typedef struct {
    uint32_t sent, retries, send_errors, adc_gaps, invalid_commands;
    uint16_t max_queued;
} RBL_Stats;
extern RBL_Stats rbl_stats;
void RBL_Init(void);
void RBL_SetConnected(uint8_t connected);
void RBL_SetSubscribed(uint8_t subscribed);
void RBL_Control(const uint8_t *data, uint16_t length, uint32_t now);
void RBL_GetStatus(uint8_t status[20]);
/* 1 queued, 0 inactive, -1 stopped because full/sequence exhausted. */
int RBL_Queue(int32_t ch1, int32_t ch2, uint32_t timestamp);
void RBL_AdcGap(void);
void RBL_Process(uint32_t now, RBL_SendFn send);
#endif
