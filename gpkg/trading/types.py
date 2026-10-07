from dataclasses import dataclass


@dataclass
class Candle:
    timestamp:int
    open:float
    high:float
    low:float
    close:float
    volume:float=0.0
