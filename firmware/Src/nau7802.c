#include "nau7802.h"
#include <stdio.h>

static NAU7802_Status NAU7802_WriteRegister(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t value)
{
    if (dev == NULL || dev->hi2c == NULL)
    {
        return NAU7802_ERROR;
    }

    if (HAL_I2C_Mem_Write(
            dev->hi2c,
            dev->address,
            reg,
            I2C_MEMADD_SIZE_8BIT,
            &value,
            1,
            NAU7802_I2C_TIMEOUT_MS) == HAL_OK)
    {
        return NAU7802_OK;
    }

    return NAU7802_ERROR;
}

static NAU7802_Status NAU7802_ReadRegister(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t *value)
{
    if (dev == NULL || dev->hi2c == NULL || value == NULL)
    {
        return NAU7802_ERROR;
    }

    if (HAL_I2C_Mem_Read(
            dev->hi2c,
            dev->address,
            reg,
            I2C_MEMADD_SIZE_8BIT,
            value,
            1,
            NAU7802_I2C_TIMEOUT_MS) == HAL_OK)
    {
        return NAU7802_OK;
    }

    return NAU7802_ERROR;
}

NAU7802_Status NAU7802_ReadRegisterPublic(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t *value)
{
    return NAU7802_ReadRegister(dev, reg, value);
}

NAU7802_Status NAU7802_WriteRegisterPublic(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t value)
{
    return NAU7802_WriteRegister(dev, reg, value);
}

static NAU7802_Status NAU7802_SetBit(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t bit)
{
    uint8_t value;

    if (NAU7802_ReadRegister(dev, reg, &value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    value |= bit;

    return NAU7802_WriteRegister(dev, reg, value);
}

static NAU7802_Status NAU7802_ClearBit(NAU7802_HandleTypeDef *dev, uint8_t reg, uint8_t bit)
{
    uint8_t value;

    if (NAU7802_ReadRegister(dev, reg, &value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    value &= (uint8_t)~bit;

    return NAU7802_WriteRegister(dev, reg, value);
}

NAU7802_Status NAU7802_IsReady(NAU7802_HandleTypeDef *dev)
{
    if (dev == NULL || dev->hi2c == NULL)
    {
        return NAU7802_ERROR;
    }

    if (HAL_I2C_IsDeviceReady(dev->hi2c, dev->address, 3, NAU7802_I2C_TIMEOUT_MS) == HAL_OK)
    {
        return NAU7802_OK;
    }

    return NAU7802_ERROR;
}

static NAU7802_Status NAU7802_Reset(NAU7802_HandleTypeDef *dev)
{
    if (NAU7802_SetBit(dev, NAU7802_REG_PU_CTRL, NAU7802_PU_CTRL_RR) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    HAL_Delay(10);

    if (NAU7802_ClearBit(dev, NAU7802_REG_PU_CTRL, NAU7802_PU_CTRL_RR) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    HAL_Delay(10);

    return NAU7802_OK;
}

static NAU7802_Status NAU7802_PowerUp(NAU7802_HandleTypeDef *dev)
{
    uint8_t value;
    uint32_t startTick;


    if (NAU7802_SetBit(dev, NAU7802_REG_PU_CTRL, NAU7802_PU_CTRL_PUD) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_SetBit(dev, NAU7802_REG_PU_CTRL, NAU7802_PU_CTRL_PUA) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    startTick = HAL_GetTick();

    while ((HAL_GetTick() - startTick) < NAU7802_POWERUP_TIMEOUT_MS)
    {
        if (NAU7802_ReadRegister(dev, NAU7802_REG_PU_CTRL, &value) != NAU7802_OK)
        {
            return NAU7802_ERROR;
        }

        if (value & NAU7802_PU_CTRL_PUR)
        {
            return NAU7802_OK;
        }

        HAL_Delay(1);
    }

    return NAU7802_TIMEOUT;
}

static NAU7802_Status NAU7802_StartConversion(NAU7802_HandleTypeDef *dev)
{
    return NAU7802_SetBit(dev, NAU7802_REG_PU_CTRL, NAU7802_PU_CTRL_CS);
}

NAU7802_Status NAU7802_SetGain(NAU7802_HandleTypeDef *dev, uint8_t gain)
{
    uint8_t value;

    if (gain > NAU7802_GAIN_128)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL1, &value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    value &= (uint8_t)~NAU7802_CTRL1_GAIN_MASK;
    value |= (gain & NAU7802_CTRL1_GAIN_MASK);

    return NAU7802_WriteRegister(dev, NAU7802_REG_CTRL1, value);
}

NAU7802_Status NAU7802_SetLDO(NAU7802_HandleTypeDef *dev, uint8_t ldo)
{
    uint8_t value;

    if (ldo > NAU7802_LDO_2V4)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL1, &value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    value &= (uint8_t)~NAU7802_CTRL1_VLDO_MASK;
    value |= (uint8_t)((ldo & 0x07) << 3);

    return NAU7802_WriteRegister(dev, NAU7802_REG_CTRL1, value);
}

NAU7802_Status NAU7802_SetSampleRate(NAU7802_HandleTypeDef *dev, uint8_t sampleRate)
{
    uint8_t value;

    if (sampleRate > NAU7802_SPS_320)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL2, &value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    value &= (uint8_t)~NAU7802_CTRL2_CRS_MASK;
    value |= (uint8_t)((sampleRate & 0x07) << 4);

    return NAU7802_WriteRegister(dev, NAU7802_REG_CTRL2, value);
}

NAU7802_Status NAU7802_SelectChannel(NAU7802_HandleTypeDef *dev, uint8_t channel)
{
    if (channel == NAU7802_CHANNEL_1)
    {
        return NAU7802_ClearBit(dev, NAU7802_REG_CTRL2, NAU7802_CTRL2_CHS);
    }

    if (channel == NAU7802_CHANNEL_2)
    {
        return NAU7802_SetBit(dev, NAU7802_REG_CTRL2, NAU7802_CTRL2_CHS);
    }

    return NAU7802_ERROR;
}

NAU7802_Status NAU7802_ConfigureChopper(NAU7802_HandleTypeDef *dev)
{

    if (NAU7802_WriteRegister(
            dev,
            NAU7802_REG_ADC,
            NAU7802_ADC_RECOMMENDED_VALUE) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_WriteRegister(
            dev,
            NAU7802_REG_PGA,
            0x00) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    return NAU7802_OK;
}

NAU7802_Status NAU7802_Calibrate(NAU7802_HandleTypeDef *dev, uint8_t mode)
{
    uint8_t value;
    uint32_t startTick;

    if (mode > NAU7802_CALMOD_GAIN)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL2, &value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    value &= (uint8_t)~NAU7802_CTRL2_CALMOD_MASK;
    value |= (mode & NAU7802_CTRL2_CALMOD_MASK);

    if (NAU7802_WriteRegister(dev, NAU7802_REG_CTRL2, value) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_SetBit(dev, NAU7802_REG_CTRL2, NAU7802_CTRL2_CALS) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    startTick = HAL_GetTick();

    while ((HAL_GetTick() - startTick) < NAU7802_CAL_TIMEOUT_MS)
    {
        if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL2, &value) != NAU7802_OK)
        {
            return NAU7802_ERROR;
        }

        if ((value & NAU7802_CTRL2_CALS) == 0)
        {
            if (value & NAU7802_CTRL2_CAL_ERROR)
            {
                return NAU7802_CAL_ERROR;
            }

            return NAU7802_OK;
        }

        HAL_Delay(1);
    }

    return NAU7802_TIMEOUT;
}

NAU7802_Status NAU7802_Init(NAU7802_HandleTypeDef *dev, I2C_HandleTypeDef *hi2c)
{
    uint8_t value;

    if (dev == NULL || hi2c == NULL)
    {
        return NAU7802_ERROR;
    }

    dev->hi2c = hi2c;
    dev->address = NAU7802_I2C_ADDRESS;

    if (NAU7802_IsReady(dev) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_Reset(dev) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    if (NAU7802_PowerUp(dev) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_SetBit(dev, NAU7802_REG_PU_CTRL, NAU7802_PU_CTRL_AVDDS) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_SetLDO(dev, NAU7802_CONFIG_LDO) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_SetGain(dev, NAU7802_CONFIG_GAIN) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_SetSampleRate(dev, NAU7802_CONFIG_SAMPLE_RATE) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_SelectChannel(dev, NAU7802_CONFIG_CHANNEL) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_ConfigureChopper(dev) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }


    HAL_Delay(250);


    if (NAU7802_Calibrate(dev, NAU7802_CALMOD_INTERNAL) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    HAL_Delay(10);

    if (NAU7802_StartConversion(dev) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    HAL_Delay(50);


    if (NAU7802_ReadRegister(dev, NAU7802_REG_PU_CTRL, &value) == NAU7802_OK)
    {
        printf("NAU7802 PU_CTRL = 0x%02X\r\n", value);
    }

    if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL1, &value) == NAU7802_OK)
    {
        printf("NAU7802 CTRL1   = 0x%02X\r\n", value);
    }

    if (NAU7802_ReadRegister(dev, NAU7802_REG_CTRL2, &value) == NAU7802_OK)
    {
        printf("NAU7802 CTRL2   = 0x%02X\r\n", value);
    }

    return NAU7802_OK;
}

NAU7802_Status NAU7802_ReadRaw(NAU7802_HandleTypeDef *dev, int32_t *value)
{
    uint8_t status;
    uint8_t data[3];
    int32_t raw;

    if (dev == NULL || dev->hi2c == NULL || value == NULL)
    {
        return NAU7802_ERROR;
    }


    if (NAU7802_ReadRegister(dev, NAU7802_REG_PU_CTRL, &status) != NAU7802_OK)
    {
        return NAU7802_ERROR;
    }

    if ((status & NAU7802_PU_CTRL_CR) == 0)
    {
        return NAU7802_NOT_READY;
    }


    if (HAL_I2C_Mem_Read(
            dev->hi2c,
            dev->address,
            NAU7802_REG_ADCO_B2,
            I2C_MEMADD_SIZE_8BIT,
            data,
            3,
            NAU7802_I2C_TIMEOUT_MS) != HAL_OK)
    {
        return NAU7802_ERROR;
    }

    raw = ((int32_t)data[0] << 16) |
          ((int32_t)data[1] << 8) |
          ((int32_t)data[2]);


    if (raw & 0x800000)
    {
        raw |= (int32_t)0xFF000000;
    }

    *value = raw;


    return NAU7802_OK;
}

NAU7802_Status NAU7802_ReadRawBlocking(NAU7802_HandleTypeDef *dev, int32_t *value, uint32_t timeoutMs)
{
    uint32_t startTick;
    NAU7802_Status status;

    if (dev == NULL || dev->hi2c == NULL || value == NULL)
    {
        return NAU7802_ERROR;
    }

    startTick = HAL_GetTick();

    while ((HAL_GetTick() - startTick) < timeoutMs)
    {
        status = NAU7802_ReadRaw(dev, value);

        if (status == NAU7802_OK)
        {
            return NAU7802_OK;
        }

        if (status != NAU7802_NOT_READY)
        {
            return status;
        }

        HAL_Delay(1);
    }

    return NAU7802_TIMEOUT;
}

void NAU7802_DumpRegisters(NAU7802_HandleTypeDef *dev)
{
    uint8_t value;

    if (dev == NULL || dev->hi2c == NULL)
    {
        printf("NAU7802 dump error: invalid handle\r\n");
        return;
    }

    printf("---- NAU7802 register dump ----\r\n");

    for (uint8_t reg = 0x00; reg <= 0x1F; reg++)
    {
        if (NAU7802_ReadRegister(dev, reg, &value) == NAU7802_OK)
        {
            printf("REG 0x%02X = 0x%02X\r\n", reg, value);
        }
        else
        {
            printf("REG 0x%02X = READ ERROR\r\n", reg);
        }
    }

    printf("-------------------------------\r\n");
}
