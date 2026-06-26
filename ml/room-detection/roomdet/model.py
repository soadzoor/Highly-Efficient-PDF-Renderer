from __future__ import annotations

import torch
from torch import nn
import torch.nn.functional as F
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class UpBlock(nn.Module):
    def __init__(self, in_channels: int, skip_channels: int, out_channels: int) -> None:
        super().__init__()
        self.block = ConvBlock(in_channels + skip_channels, out_channels)

    def forward(self, x: torch.Tensor, skip: torch.Tensor | None) -> torch.Tensor:
        target_size = skip.shape[-2:] if skip is not None else (x.shape[-2] * 2, x.shape[-1] * 2)
        x = F.interpolate(x, size=target_size, mode="bilinear", align_corners=False)
        if skip is not None:
            x = torch.cat([x, skip], dim=1)
        return self.block(x)


class MobileNetV3SmallUNet(nn.Module):
    def __init__(self, num_classes: int, pretrained: bool = False) -> None:
        super().__init__()
        weights = MobileNet_V3_Small_Weights.DEFAULT if pretrained else None
        encoder = mobilenet_v3_small(weights=weights).features
        self.encoder = encoder
        self.up1 = UpBlock(576, 48, 160)
        self.up2 = UpBlock(160, 24, 96)
        self.up3 = UpBlock(96, 16, 64)
        self.up4 = UpBlock(64, 0, 32)
        self.head = nn.Conv2d(32, num_classes, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        input_size = x.shape[-2:]
        skip16 = None
        skip24 = None
        skip48 = None

        for index, layer in enumerate(self.encoder):
            x = layer(x)
            if index == 1:
                skip16 = x
            elif index == 3:
                skip24 = x
            elif index == 8:
                skip48 = x

        x = self.up1(x, skip48)
        x = self.up2(x, skip24)
        x = self.up3(x, skip16)
        x = self.up4(x, None)
        x = F.interpolate(x, size=input_size, mode="bilinear", align_corners=False)
        return self.head(x)


def create_model(num_classes: int, pretrained: bool = False) -> nn.Module:
    return MobileNetV3SmallUNet(num_classes=num_classes, pretrained=pretrained)
