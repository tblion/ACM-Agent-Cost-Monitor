use crate::model::{CostBreakdown, Tokens};

#[derive(Debug, Clone, Copy, Default)]
pub struct Rate {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

impl Rate {
    pub fn is_valid(&self) -> bool {
        [self.input, self.output, self.cache_read, self.cache_write]
            .iter()
            .all(|value| value.is_finite() && *value >= 0.0)
    }
}

pub fn message_cost(tokens: &Tokens, rate: &Rate) -> f64 {
    message_cost_breakdown(tokens, rate).total
}

pub fn message_cost_breakdown(tokens: &Tokens, rate: &Rate) -> CostBreakdown {
    let input = tokens.input * rate.input / 1_000_000.0;
    let output = tokens.output * rate.output / 1_000_000.0;
    let cache_read = tokens.cache_read * rate.cache_read / 1_000_000.0;
    let cache_write = tokens.cache_write * rate.cache_write / 1_000_000.0;
    let reasoning = tokens.reasoning * rate.output / 1_000_000.0;
    let total = input + output + cache_read + cache_write + reasoning;

    CostBreakdown {
        input,
        output,
        cache_read,
        cache_write,
        reasoning,
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_rate() {
        let t = Tokens {
            input: 1e6,
            output: 1e6,
            cache_read: 1e6,
            cache_write: 1e6,
            reasoning: 1e6,
        };
        let r = Rate {
            input: 2.0,
            output: 8.0,
            cache_read: 0.2,
            cache_write: 2.5,
        };
        // 2 + 8 + 0.2 + 2.5 + 8 (reasoning@output) = 20.7
        assert!((message_cost(&t, &r) - 20.7).abs() < 1e-9);
    }

    #[test]
    fn full_rate_breakdown() {
        let t = Tokens {
            input: 1e6,
            output: 1e6,
            cache_read: 1e6,
            cache_write: 1e6,
            reasoning: 1e6,
        };
        let r = Rate {
            input: 2.0,
            output: 8.0,
            cache_read: 0.2,
            cache_write: 2.5,
        };
        let breakdown = message_cost_breakdown(&t, &r);

        assert_eq!(breakdown.input, 2.0);
        assert_eq!(breakdown.output, 8.0);
        assert_eq!(breakdown.cache_read, 0.2);
        assert_eq!(breakdown.cache_write, 2.5);
        assert_eq!(breakdown.reasoning, 8.0);
        assert!((breakdown.total - 20.7).abs() < 1e-9);
    }

    #[test]
    fn zero_tokens_zero_cost() {
        assert_eq!(message_cost(&Tokens::default(), &Rate::default()), 0.0);
    }
}
