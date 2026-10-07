from gpkg.ml.baseline import conservative_friction_bps


def test_baseline_charges_double_peak_spread_and_roundtrip_taker(): assert conservative_friction_bps(4.2,5.5,1.0)==20.4
def test_friction_is_nonnegative(): assert conservative_friction_bps(-1,-2,-3)==0.0
