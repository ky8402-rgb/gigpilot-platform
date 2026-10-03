"""Exchange error taxonomy.

Extracted from the monolith so every layer (exchange, execution, accounting, risk) can raise and
catch the same types without importing the engine.
"""


class BybitError(Exception):
    """A business error returned BY BYBIT (HTTP 200 with retCode != 0).

    Distinct from a transport failure on purpose: a parsed retCode is a definitive answer from the
    exchange, whereas a timeout/5xx means the outcome is UNKNOWN. Collapsing the two is how a lost
    response gets misreported as a rejection.
    """

    def __init__(self, code: int, msg: str):
        super().__init__(f"Bybit {code}: {msg}")
        self.code = code
        self.msg = msg


# Bybit answers with this code when a client order id is REUSED. It is not a failure: it means an
# earlier attempt carrying the same orderLinkId was already accepted. Because the REST client retries
# network errors (correctly reusing the same body, hence the same key), this is the NORMAL outcome
# when a submission succeeded but its response was lost. Reading it as "failed" reports an order — or
# an emergency flatten — as not having happened while it did.
DUPLICATE_ORDER_LINK_CODE = 110072
