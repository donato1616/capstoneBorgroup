# arima_forecast.py
import sys
import json
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
import matplotlib.pyplot as plt

# Load time series data
time_series_data = json.loads(sys.argv[2])

# Convert to pandas DataFrame
df = pd.DataFrame(time_series_data, columns=['date', 'value'])
df['date'] = pd.to_datetime(df['date'])
df.set_index('date', inplace=True)

# Fit ARIMA model
model = ARIMA(df['value'], order=(5,1,0))  # Adjust order as needed
model_fit = model.fit()

# Forecast for next 7 days
forecast = model_fit.forecast(steps=7)

# Plot results
plt.plot(df.index, df['value'], label='Actual Data')
plt.plot(pd.date_range(df.index[-1], periods=8, freq='D')[1:], forecast, label='Forecast', linestyle='--')
plt.legend()
plt.savefig("/path/to/save/arima_forecast.png")  # Save chart

# Output results
result = {
    'forecast': forecast.tolist(),
    'chart': '/path/to/save/arima_forecast.png'  # Send chart path for frontend
}
print(json.dumps(result))