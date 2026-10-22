################################################################################
# Automatically-generated file. Do not edit!
# Toolchain: GNU Tools for STM32 (14.3.rel1)
################################################################################

# Add inputs and outputs from these tool invocations to the build variables 
C_SRCS += \
../Src/app_ble.c \
../Src/app_debug.c \
../Src/app_entry.c \
../Src/custom_app.c \
../Src/custom_stm.c \
../Src/hw_ipcc.c \
../Src/hw_timerserver.c \
../Src/main.c \
../Src/nau7802.c \
../Src/reliable_ble.c \
../Src/stm32_lpm_if.c \
../Src/stm32wbxx_hal_msp.c \
../Src/stm32wbxx_it.c \
../Src/syscalls.c \
../Src/sysmem.c \
../Src/system_stm32wbxx.c \
../Src/usb_device.c \
../Src/usbd_cdc_if.c \
../Src/usbd_conf.c \
../Src/usbd_desc.c 

OBJS += \
./Src/app_ble.o \
./Src/app_debug.o \
./Src/app_entry.o \
./Src/custom_app.o \
./Src/custom_stm.o \
./Src/hw_ipcc.o \
./Src/hw_timerserver.o \
./Src/main.o \
./Src/nau7802.o \
./Src/reliable_ble.o \
./Src/stm32_lpm_if.o \
./Src/stm32wbxx_hal_msp.o \
./Src/stm32wbxx_it.o \
./Src/syscalls.o \
./Src/sysmem.o \
./Src/system_stm32wbxx.o \
./Src/usb_device.o \
./Src/usbd_cdc_if.o \
./Src/usbd_conf.o \
./Src/usbd_desc.o 

C_DEPS += \
./Src/app_ble.d \
./Src/app_debug.d \
./Src/app_entry.d \
./Src/custom_app.d \
./Src/custom_stm.d \
./Src/hw_ipcc.d \
./Src/hw_timerserver.d \
./Src/main.d \
./Src/nau7802.d \
./Src/reliable_ble.d \
./Src/stm32_lpm_if.d \
./Src/stm32wbxx_hal_msp.d \
./Src/stm32wbxx_it.d \
./Src/syscalls.d \
./Src/sysmem.d \
./Src/system_stm32wbxx.d \
./Src/usb_device.d \
./Src/usbd_cdc_if.d \
./Src/usbd_conf.d \
./Src/usbd_desc.d 


# Each subdirectory must supply rules for building sources it contributes
Src/%.o Src/%.su Src/%.cyclo: ../Src/%.c Src/subdir.mk
	arm-none-eabi-gcc "$<" -mcpu=cortex-m4 -std=gnu11 -g3 -DDEBUG -DUSE_HAL_DRIVER -DSTM32WB55xx -c -I../Inc -I../Drivers/STM32WBxx_HAL_Driver/Inc -I../Drivers/STM32WBxx_HAL_Driver/Inc/Legacy -I../Utilities/lpm/tiny_lpm -I../Middlewares/ST/STM32_WPAN -I../Middlewares/ST/STM32_WPAN/interface/patterns/ble_thread -I../Middlewares/ST/STM32_WPAN/interface/patterns/ble_thread/tl -I../Middlewares/ST/STM32_WPAN/interface/patterns/ble_thread/shci -I../Middlewares/ST/STM32_WPAN/utilities -I../Middlewares/ST/STM32_WPAN/ble/core -I../Middlewares/ST/STM32_WPAN/ble/core/auto -I../Middlewares/ST/STM32_WPAN/ble/core/template -I../Middlewares/ST/STM32_WPAN/ble/svc/Inc -I../Middlewares/ST/STM32_WPAN/ble/svc/Src -I../Middlewares/ST/STM32_USB_Device_Library/Core/Inc -I../Middlewares/ST/STM32_USB_Device_Library/Class/CDC/Inc -I../Drivers/CMSIS/Device/ST/STM32WBxx/Include -I../Utilities/sequencer -I../Middlewares/ST/STM32_WPAN/ble -I../Drivers/CMSIS/Include -O0 -ffunction-sections -fdata-sections -Wall -fstack-usage -fcyclomatic-complexity -MMD -MP -MF"$(@:%.o=%.d)" -MT"$@" --specs=nano.specs -mfpu=fpv4-sp-d16 -mfloat-abi=hard -mthumb -o "$@"

clean: clean-Src

clean-Src:
	-$(RM) ./Src/app_ble.cyclo ./Src/app_ble.d ./Src/app_ble.o ./Src/app_ble.su ./Src/app_debug.cyclo ./Src/app_debug.d ./Src/app_debug.o ./Src/app_debug.su ./Src/app_entry.cyclo ./Src/app_entry.d ./Src/app_entry.o ./Src/app_entry.su ./Src/custom_app.cyclo ./Src/custom_app.d ./Src/custom_app.o ./Src/custom_app.su ./Src/custom_stm.cyclo ./Src/custom_stm.d ./Src/custom_stm.o ./Src/custom_stm.su ./Src/hw_ipcc.cyclo ./Src/hw_ipcc.d ./Src/hw_ipcc.o ./Src/hw_ipcc.su ./Src/hw_timerserver.cyclo ./Src/hw_timerserver.d ./Src/hw_timerserver.o ./Src/hw_timerserver.su ./Src/main.cyclo ./Src/main.d ./Src/main.o ./Src/main.su ./Src/nau7802.cyclo ./Src/nau7802.d ./Src/nau7802.o ./Src/nau7802.su ./Src/reliable_ble.cyclo ./Src/reliable_ble.d ./Src/reliable_ble.o ./Src/reliable_ble.su ./Src/stm32_lpm_if.cyclo ./Src/stm32_lpm_if.d ./Src/stm32_lpm_if.o ./Src/stm32_lpm_if.su ./Src/stm32wbxx_hal_msp.cyclo ./Src/stm32wbxx_hal_msp.d ./Src/stm32wbxx_hal_msp.o ./Src/stm32wbxx_hal_msp.su ./Src/stm32wbxx_it.cyclo ./Src/stm32wbxx_it.d ./Src/stm32wbxx_it.o ./Src/stm32wbxx_it.su ./Src/syscalls.cyclo ./Src/syscalls.d ./Src/syscalls.o ./Src/syscalls.su ./Src/sysmem.cyclo ./Src/sysmem.d ./Src/sysmem.o ./Src/sysmem.su ./Src/system_stm32wbxx.cyclo ./Src/system_stm32wbxx.d ./Src/system_stm32wbxx.o ./Src/system_stm32wbxx.su ./Src/usb_device.cyclo ./Src/usb_device.d ./Src/usb_device.o ./Src/usb_device.su ./Src/usbd_cdc_if.cyclo ./Src/usbd_cdc_if.d ./Src/usbd_cdc_if.o ./Src/usbd_cdc_if.su ./Src/usbd_conf.cyclo ./Src/usbd_conf.d ./Src/usbd_conf.o ./Src/usbd_conf.su ./Src/usbd_desc.cyclo ./Src/usbd_desc.d ./Src/usbd_desc.o ./Src/usbd_desc.su

.PHONY: clean-Src

