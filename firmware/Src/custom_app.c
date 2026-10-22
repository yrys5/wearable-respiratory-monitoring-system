/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file    custom_app.c
  * @author  MCD Application Team
  * @brief   Custom Example Application (Server)
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */

/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "app_common.h"
#include "dbg_trace.h"
#include "ble.h"
#include "custom_app.h"
#include "custom_stm.h"
#include "stm32_seq.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "reliable_ble.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
typedef struct
{
  /* BrathingAnalyzerService */
  uint8_t               Bawb55_Notification_Status;
  uint8_t               Bawb55_Indication_Status;
  /* USER CODE BEGIN CUSTOM_APP_Context_t */

  /* USER CODE END CUSTOM_APP_Context_t */

  uint16_t              ConnectionHandle;
} Custom_App_Context_t;

/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private defines ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macros -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
/**
 * START of Section BLE_APP_CONTEXT
 */

static Custom_App_Context_t Custom_App_Context;

/**
 * END of Section BLE_APP_CONTEXT
 */

uint8_t UpdateCharData[512];
uint8_t NotifyCharData[512];
uint16_t Connection_Handle;
/* USER CODE BEGIN PV */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
/* BrathingAnalyzerService */
static void Custom_Bawb55_Update_Char(void);
static void Custom_Bawb55_Send_Notification(void);
static void Custom_Bawb55_Send_Indication(void);

/* USER CODE BEGIN PFP */
static int SendPacket(const uint8_t packet[20]);
/* USER CODE END PFP */

/* Functions Definition ------------------------------------------------------*/
void Custom_STM_App_Notification(Custom_STM_App_Notification_evt_t *pNotification)
{
  /* USER CODE BEGIN CUSTOM_STM_App_Notification_1 */

  /* USER CODE END CUSTOM_STM_App_Notification_1 */
  switch (pNotification->Custom_Evt_Opcode)
  {
    /* USER CODE BEGIN CUSTOM_STM_App_Notification_Custom_Evt_Opcode */

    /* USER CODE END CUSTOM_STM_App_Notification_Custom_Evt_Opcode */

    /* BrathingAnalyzerService */
    case CUSTOM_STM_BAWB55_READ_EVT:
      /* USER CODE BEGIN CUSTOM_STM_BAWB55_READ_EVT */

      /* USER CODE END CUSTOM_STM_BAWB55_READ_EVT */
      break;

    case CUSTOM_STM_BAWB55_NOTIFY_ENABLED_EVT:
      /* USER CODE BEGIN CUSTOM_STM_BAWB55_NOTIFY_ENABLED_EVT */
      RBL_SetSubscribed(1);
      /* USER CODE END CUSTOM_STM_BAWB55_NOTIFY_ENABLED_EVT */
      break;

    case CUSTOM_STM_BAWB55_NOTIFY_DISABLED_EVT:
      /* USER CODE BEGIN CUSTOM_STM_BAWB55_NOTIFY_DISABLED_EVT */
      RBL_SetSubscribed(0);
      /* USER CODE END CUSTOM_STM_BAWB55_NOTIFY_DISABLED_EVT */
      break;

    case CUSTOM_STM_BAWB55_INDICATE_ENABLED_EVT:
      /* USER CODE BEGIN CUSTOM_STM_BAWB55_INDICATE_ENABLED_EVT */

      /* USER CODE END CUSTOM_STM_BAWB55_INDICATE_ENABLED_EVT */
      break;

    case CUSTOM_STM_BAWB55_INDICATE_DISABLED_EVT:
      /* USER CODE BEGIN CUSTOM_STM_BAWB55_INDICATE_DISABLED_EVT */

      /* USER CODE END CUSTOM_STM_BAWB55_INDICATE_DISABLED_EVT */
      break;

    case CUSTOM_STM_NOTIFICATION_COMPLETE_EVT:
      /* USER CODE BEGIN CUSTOM_STM_NOTIFICATION_COMPLETE_EVT */
      /* This event is not an application-level acknowledgement. */
      /* USER CODE END CUSTOM_STM_NOTIFICATION_COMPLETE_EVT */
      break;

    default:
      /* USER CODE BEGIN CUSTOM_STM_App_Notification_default */

      /* USER CODE END CUSTOM_STM_App_Notification_default */
      break;
  }
  /* USER CODE BEGIN CUSTOM_STM_App_Notification_2 */

  /* USER CODE END CUSTOM_STM_App_Notification_2 */
  return;
}

void Custom_APP_Notification(Custom_App_ConnHandle_Not_evt_t *pNotification)
{
  /* USER CODE BEGIN CUSTOM_APP_Notification_1 */

  /* USER CODE END CUSTOM_APP_Notification_1 */

  switch (pNotification->Custom_Evt_Opcode)
  {
    /* USER CODE BEGIN CUSTOM_APP_Notification_Custom_Evt_Opcode */

    /* USER CODE END CUSTOM_APP_Notification_Custom_Evt_Opcode */
    case CUSTOM_CONN_HANDLE_EVT :
      /* USER CODE BEGIN CUSTOM_CONN_HANDLE_EVT */
      Connection_Handle = pNotification->ConnectionHandle;
      RBL_SetConnected(1);

      HAL_GPIO_WritePin(GPIOA, GPIO_PIN_1, GPIO_PIN_SET);
      /* USER CODE END CUSTOM_CONN_HANDLE_EVT */
      break;

    case CUSTOM_DISCON_HANDLE_EVT :
      /* USER CODE BEGIN CUSTOM_DISCON_HANDLE_EVT */
      RBL_SetConnected(0);
      Connection_Handle = 0xffff;

      HAL_GPIO_WritePin(GPIOA, GPIO_PIN_1, GPIO_PIN_RESET);
      /* USER CODE END CUSTOM_DISCON_HANDLE_EVT */
      break;

    default:
      /* USER CODE BEGIN CUSTOM_APP_Notification_default */

      /* USER CODE END CUSTOM_APP_Notification_default */
      break;
  }

  /* USER CODE BEGIN CUSTOM_APP_Notification_2 */

  /* USER CODE END CUSTOM_APP_Notification_2 */

  return;
}

void Custom_APP_Init(void)
{
  /* USER CODE BEGIN CUSTOM_APP_Init */
  RBL_Init();
  /* USER CODE END CUSTOM_APP_Init */
  return;
}

/* USER CODE BEGIN FD */
void Custom_APP_Process(void)
{
  RBL_Process(HAL_GetTick(), SendPacket);
}

void Custom_APP_SendAdcValue(int32_t value1, int32_t value2)
{
  /* Queue overflow is recorded in the reliable transport status. */
  (void)RBL_Queue(value1, value2, HAL_GetTick());
}

void Custom_APP_AdcGap(void)
{
  RBL_AdcGap();
}

void Custom_APP_GetStatus(uint8_t status[20])
{
  RBL_GetStatus(status);
}

void Custom_APP_Control(const uint8_t *data, uint16_t length)
{
  RBL_Control(data, length, HAL_GetTick());
}
/* USER CODE END FD */

/*************************************************************
 *
 * LOCAL FUNCTIONS
 *
 *************************************************************/

/* BrathingAnalyzerService */
__USED void Custom_Bawb55_Update_Char(void) /* Property Read */
{
  uint8_t updateflag = 0;

  /* USER CODE BEGIN Bawb55_UC_1*/

  /* USER CODE END Bawb55_UC_1*/

  if (updateflag != 0)
  {
    Custom_STM_App_Update_Char(CUSTOM_STM_BAWB55, (uint8_t *)UpdateCharData);
  }

  /* USER CODE BEGIN Bawb55_UC_Last*/

  /* USER CODE END Bawb55_UC_Last*/
  return;
}

void Custom_Bawb55_Send_Notification(void) /* Property Notification */
{
  uint8_t updateflag = 0;

  /* USER CODE BEGIN Bawb55_NS_1*/

  /* USER CODE END Bawb55_NS_1*/

  if (updateflag != 0)
  {
    Custom_STM_App_Update_Char(CUSTOM_STM_BAWB55, (uint8_t *)NotifyCharData);
  }

  /* USER CODE BEGIN Bawb55_NS_Last*/

  /* USER CODE END Bawb55_NS_Last*/

  return;
}

void Custom_Bawb55_Send_Indication(void) /* Property Indication */
{
  uint8_t updateflag = 0;

  /* USER CODE BEGIN Bawb55_IS_1*/

  /* USER CODE END Bawb55_IS_1*/

  if (updateflag != 0)
  {
    Custom_STM_App_Update_Char(CUSTOM_STM_BAWB55, (uint8_t *)NotifyCharData);
  }

  /* USER CODE BEGIN Bawb55_IS_Last*/

  /* USER CODE END Bawb55_IS_Last*/

  return;
}

/* USER CODE BEGIN FD_LOCAL_FUNCTIONS*/
static int SendPacket(const uint8_t packet[20])
{
  return Custom_STM_App_Update_Char(CUSTOM_STM_BAWB55,
                                   (uint8_t *)packet) == BLE_STATUS_SUCCESS ? 0 : -1;
}
/* USER CODE END FD_LOCAL_FUNCTIONS*/
