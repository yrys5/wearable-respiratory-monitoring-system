#ifndef INC_NAU7802_H_
#define INC_NAU7802_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"
#include <stdint.h>


#define NAU7802_I2C_ADDRESS_7BIT      0x2A
#define NAU7802_I2C_ADDRESS           (NAU7802_I2C_ADDRESS_7BIT << 1)

/*
 * Rejestry NAU7802
 */
#define NAU7802_REG_PU_CTRL           0x00
#define NAU7802_REG_CTRL1             0x01
#define NAU7802_REG_CTRL2             0x02
#define NAU7802_REG_OCAL1_B2          0x03
#define NAU7802_REG_OCAL1_B1          0x04
#define NAU7802_REG_OCAL1_B0          0x05
#define NAU7802_REG_GCAL1_B3          0x06
#define NAU7802_REG_GCAL1_B2          0x07
#define NAU7802_REG_GCAL1_B1          0x08
#define NAU7802_REG_GCAL1_B0          0x09
#define NAU7802_REG_OCAL2_B2          0x0A
#define NAU7802_REG_OCAL2_B1          0x0B
#define NAU7802_REG_OCAL2_B0          0x0C
#define NAU7802_REG_GCAL2_B3          0x0D
#define NAU7802_REG_GCAL2_B2          0x0E
#define NAU7802_REG_GCAL2_B1          0x0F
#define NAU7802_REG_GCAL2_B0          0x10
#define NAU7802_REG_I2C_CONTROL       0x11
#define NAU7802_REG_ADCO_B2           0x12
#define NAU7802_REG_ADCO_B1           0x13
#define NAU7802_REG_ADCO_B0           0x14
#define NAU7802_REG_ADC               0x15
#define NAU7802_REG_OTP_B1            0x16
#define NAU7802_REG_OTP_B0            0x17
#define NAU7802_REG_PGA               0x1B
#define NAU7802_REG_POWER             0x1C
#define NAU7802_REG_REVISION_ID       0x1F

#define NAU7802_ADC_RECOMMENDED_VALUE       0x30

#define NAU7802_PGA_OUTPUT_BUFFER_ENABLE    (1U << 5)
#define NAU7802_PGA_BYPASS_ENABLE           (1U << 4)
#define NAU7802_PGA_CHOPPER_DISABLE         (1U << 0)

/*
 * PU_CTRL bits
 */
#define NAU7802_PU_CTRL_RR            (1 << 0)  // Register reset
#define NAU7802_PU_CTRL_PUD           (1 << 1)  // Power up digital
#define NAU7802_PU_CTRL_PUA           (1 << 2)  // Power up analog
#define NAU7802_PU_CTRL_PUR           (1 << 3)  // Power up ready
#define NAU7802_PU_CTRL_CS            (1 << 4)  // Cycle start
#define NAU7802_PU_CTRL_CR            (1 << 5)  // Conversion ready
#define NAU7802_PU_CTRL_OSCS          (1 << 6)  // System clock source
#define NAU7802_PU_CTRL_AVDDS         (1 << 7)  // Use AVDD as reference / analog supply selection

/*
 * CTRL1
 * Bits 0..2 - PGA gain
 * Bits 3..5 - VLDO
 */
#define NAU7802_CTRL1_GAIN_MASK       0x07
#define NAU7802_CTRL1_VLDO_MASK       0x38

/*
 * Gain values
 */
#define NAU7802_GAIN_1                0x00
#define NAU7802_GAIN_2                0x01
#define NAU7802_GAIN_4                0x02
#define NAU7802_GAIN_8                0x03
#define NAU7802_GAIN_16               0x04
#define NAU7802_GAIN_32               0x05
#define NAU7802_GAIN_64               0x06
#define NAU7802_GAIN_128              0x07

#define NAU7802_LDO_4V5               0x00
#define NAU7802_LDO_4V2               0x01
#define NAU7802_LDO_3V9               0x02
#define NAU7802_LDO_3V6               0x03
#define NAU7802_LDO_3V3               0x04
#define NAU7802_LDO_3V0               0x05
#define NAU7802_LDO_2V7               0x06
#define NAU7802_LDO_2V4               0x07

/*
 * CTRL2
 * Bits 0..1 - calibration mode
 * Bit 2     - calibration start
 * Bit 3     - calibration error
 * Bits 4..6 - conversion rate
 * Bit 7     - channel select
 */
#define NAU7802_CTRL2_CALMOD_MASK     0x03
#define NAU7802_CTRL2_CALS            (1 << 2)
#define NAU7802_CTRL2_CAL_ERROR       (1 << 3)
#define NAU7802_CTRL2_CRS_MASK        0x70
#define NAU7802_CTRL2_CHS             (1 << 7)

/*
 * Calibration modes
 */
#define NAU7802_CALMOD_INTERNAL       0x00
#define NAU7802_CALMOD_OFFSET         0x02
#define NAU7802_CALMOD_GAIN           0x03


#define NAU7802_SPS_10                0x00
#define NAU7802_SPS_20                0x01
#define NAU7802_SPS_40                0x02
#define NAU7802_SPS_80                0x03
#define NAU7802_SPS_320               0x07

#define NAU7802_CHANNEL_1             1
#define NAU7802_CHANNEL_2             2

#define NAU7802_CONFIG_LDO            NAU7802_LDO_3V3
#define NAU7802_CONFIG_GAIN           NAU7802_GAIN_1
#define NAU7802_CONFIG_SAMPLE_RATE    NAU7802_SPS_10
#define NAU7802_CONFIG_CHANNEL        NAU7802_CHANNEL_1

#define NAU7802_I2C_TIMEOUT_MS        100
#define NAU7802_POWERUP_TIMEOUT_MS    1000
#define NAU7802_CAL_TIMEOUT_MS        1000
#define NAU7802_DATA_TIMEOUT_MS       500

typedef enum
{
    NAU7802_OK = 0,
    NAU7802_ERROR,
    NAU7802_NOT_READY,
    NAU7802_TIMEOUT,
    NAU7802_CAL_ERROR
} NAU7802_Status;

typedef struct
{
    I2C_HandleTypeDef *hi2c;
    uint16_t address;
} NAU7802_HandleTypeDef;

NAU7802_Status NAU7802_Init(NAU7802_HandleTypeDef *dev, I2C_HandleTypeDef *hi2c);
NAU7802_Status NAU7802_IsReady(NAU7802_HandleTypeDef *dev);

NAU7802_Status NAU7802_ReadRaw(NAU7802_HandleTypeDef *dev, int32_t *value);
NAU7802_Status NAU7802_ReadRawBlocking(NAU7802_HandleTypeDef *dev, int32_t *value, uint32_t timeoutMs);

NAU7802_Status NAU7802_SetGain(NAU7802_HandleTypeDef *dev, uint8_t gain);
NAU7802_Status NAU7802_SetLDO(NAU7802_HandleTypeDef *dev, uint8_t ldo);
NAU7802_Status NAU7802_SetSampleRate(NAU7802_HandleTypeDef *dev, uint8_t sampleRate);
NAU7802_Status NAU7802_SelectChannel(NAU7802_HandleTypeDef *dev, uint8_t channel);
NAU7802_Status NAU7802_Calibrate(NAU7802_HandleTypeDef *dev, uint8_t mode);
NAU7802_Status NAU7802_ConfigureChopper(NAU7802_HandleTypeDef *dev);

NAU7802_Status NAU7802_ReadRegisterPublic(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t *value);
NAU7802_Status NAU7802_WriteRegisterPublic(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t value);

void NAU7802_DumpRegisters(NAU7802_HandleTypeDef *dev);

#ifdef __cplusplus
}
#endif

#endif /* INC_NAU7802_H_ */
